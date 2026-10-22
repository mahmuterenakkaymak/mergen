import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCar, stepCar } from '../src/car.js';

const C = CONFIG.car;
const gas = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
const NEAR = 0.05; // m/s tolerance for "at maxSpeed"

// Brief test 3: full throttle takes 3-4 s to reach maxSpeed, at any frame rate.
function timeToMax(dt) {
  const car = createCar({ x: 0, z: 0 });
  let t = 0;
  while (car.speed < C.maxSpeed - NEAR && t < 20) {
    stepCar(car, gas, dt);
    t += dt;
  }
  return { t, car };
}

describe('throttle taper', () => {
  for (const hz of [60, 144]) {
    it(`reaches maxSpeed in 3-4 s at ${hz} Hz without exceeding it`, () => {
      const { t, car } = timeToMax(1 / hz);
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(4);
      expect(Math.hypot(car.vx, car.vz)).toBeLessThanOrEqual(C.maxSpeed + 1e-9);
    });
  }

  it('settles on maxSpeed under sustained throttle instead of plateauing below it', () => {
    const car = createCar({ x: 0, z: 0 });
    for (let i = 0; i < 900; i++) {
      stepCar(car, gas, 1 / 60);
      expect(Math.hypot(car.vx, car.vz)).toBeLessThanOrEqual(C.maxSpeed + 1e-9);
    }
    expect(car.speed).toBeCloseTo(C.maxSpeed, 6);
  });

  it('pulls hardest off the line and softens as speed climbs', () => {
    const gain = (from, dt = 1 / 60) => {
      const car = createCar({ x: 0, z: 0 });
      car.vz = from;
      stepCar(car, gas, dt);
      return (car.speed - from) / dt;
    };
    expect(gain(0)).toBeGreaterThan(gain(C.maxSpeed * 0.95) * 2);
    expect(gain(C.maxSpeed * 0.95)).toBeGreaterThan(0);
  });
});
