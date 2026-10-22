import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCar, stepCar } from '../src/car.js';

const C = CONFIG.car;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const gas = { ...idle, throttle: 1 };
const brake = { ...idle, brake: 1 };
const DT = 1 / 60;

function run(car, controls, seconds) {
  for (let t = 0; t < seconds; t += DT) stepCar(car, controls, DT);
  return car;
}

describe('stepCar brake-then-reverse', () => {
  it('brakes forward motion hard, then crosses into reverse', () => {
    const car = run(createCar({ x: 0, z: 0 }), gas, 1); // ~10.5 m/s forward
    const v0 = car.speed;
    run(car, brake, 0.5); // brake 24 m/s^2 stops ~10.5 in ~0.45 s
    expect(car.speed).toBeLessThan(v0 * 0.1);
    run(car, brake, 1);
    expect(car.speed).toBeLessThan(0);
  });

  it('reverse converges to reverseMax, well under forward maxSpeed', () => {
    const car = run(createCar({ x: 0, z: 0 }), brake, 6);
    expect(car.speed).toBeLessThan(0);
    expect(Math.abs(car.speed)).toBeGreaterThan(C.reverseMax * 0.98);
    expect(Math.abs(car.speed)).toBeLessThan(C.reverseMax + C.accel * 0.6 * DT); // one frame's overshoot past the cap
    expect(C.reverseMax).toBeLessThan(C.maxSpeed);
    expect(Math.abs(car.speed)).toBeLessThan(C.maxSpeed);
  });

  it('reverse drives backwards along the heading', () => {
    const car = run(createCar({ x: 0, z: 0 }), brake, 2);
    expect(car.z).toBeLessThan(0); // heading 0 faces +z
    expect(Math.abs(car.x)).toBeLessThan(1e-12);
  });
});

describe('stepCar steering', () => {
  it('smooths the steer angle toward +/- steerMax and back to 0', () => {
    const car = createCar({ x: 0, z: 0 });
    stepCar(car, { ...idle, steer: 1 }, DT);
    expect(car.steer).toBeGreaterThan(0);
    expect(car.steer).toBeLessThan(C.steerMax); // one frame shaves a slice, not everything
    run(car, { ...idle, steer: 1 }, 2);
    expect(car.steer).toBeCloseTo(C.steerMax, 6);
    run(car, { ...idle, steer: -1 }, 2);
    expect(car.steer).toBeCloseTo(-C.steerMax, 6);
    run(car, idle, 2);
    expect(car.steer).toBeCloseTo(0, 6);
  });

  it('no pivot at standstill: full steer for 2 s changes nothing', () => {
    const car = run(createCar({ x: 5, z: -2 }), { ...idle, steer: 1 }, 2);
    expect(car.heading).toBe(0);
    expect(car.x).toBe(5);
    expect(car.z).toBe(-2);
    expect(car.vx).toBe(0);
    expect(car.vz).toBe(0);
  });

  it('turn authority scales with speed below refSpeed, saturates above', () => {
    const drift = (vz) => {
      const car = createCar({ x: 0, z: 0 });
      car.vz = vz;
      const h0 = car.heading;
      stepCar(car, { ...idle, steer: 1 }, DT);
      return car.heading - h0;
    };
    const half = drift(C.refSpeed / 2);
    const full = drift(C.refSpeed);
    const over = drift(C.maxSpeed);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 10);
    expect(over).toBeCloseTo(full, 10);
  });

  it('A/D mirror: equal and opposite heading and lateral drift', () => {
    const drive = (steer) => {
      const car = createCar({ x: 0, z: 0 });
      const h0 = car.heading;
      run(car, { ...gas, steer }, 1); // throttle along the turned heading produces lateral drift
      return { dh: car.heading - h0, x: car.x };
    };
    const left = drive(1);
    const right = drive(-1);
    expect(left.dh).toBeGreaterThan(0);
    expect(left.dh).toBeCloseTo(-right.dh, 6);
    expect(left.x).toBeGreaterThan(0);
    expect(left.x).toBeCloseTo(-right.x, 6);
  });

  it('steering sign flips in reverse', () => {
    const fwd = run(createCar({ x: 0, z: 0 }), gas, 2); // ~21 m/s forward
    const h0 = fwd.heading;
    run(fwd, { ...gas, steer: 1 }, 0.4);
    expect(fwd.heading - h0).toBeGreaterThan(0);

    const rev = run(createCar({ x: 0, z: 0 }), brake, 1.5); // ~-9 m/s
    expect(rev.speed).toBeLessThan(0);
    const h1 = rev.heading;
    run(rev, { ...brake, steer: 1 }, 0.4);
    expect(rev.heading - h1).toBeLessThan(0);
  });
});
