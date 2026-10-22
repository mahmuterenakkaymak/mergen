import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCar, stepCar } from '../src/car.js';

const C = CONFIG.car;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const gas = { ...idle, throttle: 1 };
const DT = 1 / 60;

const speedOf = (car) => Math.hypot(car.vx, car.vz);

function run(car, controls, seconds, dt = DT) {
  for (let t = 0; t < seconds; t += dt) stepCar(car, controls, dt);
  return car;
}

describe('createCar', () => {
  it('spawns at the given pose, stationary', () => {
    const car = createCar({ x: 3, z: -8, heading: Math.PI / 2 });
    expect(car.x).toBe(3);
    expect(car.z).toBe(-8);
    expect(car.heading).toBe(Math.PI / 2);
    expect(car.vx).toBe(0);
    expect(car.vz).toBe(0);
    expect(car.speed).toBe(0);
  });

  it('defaults heading to 0', () => {
    expect(createCar({ x: 0, z: 0 }).heading).toBe(0);
  });
});

describe('stepCar throttle', () => {
  it('accelerates along the heading', () => {
    const car = run(createCar({ x: 0, z: 0 }), gas, 1);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.z).toBeGreaterThan(0); // heading 0 faces +z
    expect(Math.abs(car.x)).toBeLessThan(1e-12);
  });

  it('goes 0 -> maxSpeed in 3-4 s and never exceeds it', () => {
    const car = createCar({ x: 0, z: 0 });
    let t = 0;
    while (car.speed < C.maxSpeed && t < 10) {
      stepCar(car, gas, DT);
      t += DT;
      expect(speedOf(car)).toBeLessThanOrEqual(C.maxSpeed + 1e-9);
    }
    expect(t).toBeGreaterThanOrEqual(3);
    expect(t).toBeLessThanOrEqual(4);
    expect(car.speed).toBeGreaterThanOrEqual(C.maxSpeed - 1e-6);
  });

  it('holds maxSpeed under sustained throttle', () => {
    const car = run(createCar({ x: 0, z: 0 }), gas, 8);
    expect(car.speed).toBeCloseTo(C.maxSpeed, 6);
  });

  it('decays gradually on release, then snaps to 0 below 0.4 m/s', () => {
    const car = run(createCar({ x: 0, z: 0 }), gas, 1); // ~10.5 m/s
    const v0 = speedOf(car);
    stepCar(car, idle, DT);
    const v1 = speedOf(car);
    expect(v1).toBeLessThan(v0);
    expect(v1).toBeGreaterThan(v0 * 0.9); // one frame shaves a slice, not everything

    let t = 0;
    while (speedOf(car) > 0 && t < 30) {
      stepCar(car, idle, DT);
      t += DT;
    }
    expect(speedOf(car)).toBe(0);
    expect(car.vx).toBe(0);
    expect(car.vz).toBe(0);
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(v0 / C.rollResist); // drag makes it stop faster than rolling alone
  });

  it('stays parked: no input at standstill never starts motion', () => {
    const car = run(createCar({ x: 5, z: -2 }), idle, 2);
    expect(car.vx).toBe(0);
    expect(car.vz).toBe(0);
    expect(car.x).toBe(5);
    expect(car.z).toBe(-2);
  });
});
