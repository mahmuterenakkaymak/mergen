import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCar, stepCar } from '../src/car.js';

const C = CONFIG.car;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const gas = { ...idle, throttle: 1 };

function runFrames(car, controls, frames, dt) {
  for (let i = 0; i < frames; i++) stepCar(car, controls, dt);
  return car;
}

// Drive straight for `sec` seconds at `dt`, then steer with handbrake `hb` for `dSec`.
function drift(dt, sec, dSec, hb) {
  const car = createCar({ x: 0, z: 0 });
  runFrames(car, gas, Math.round(sec / dt), dt);
  return runFrames(car, { ...gas, steer: 1, handbrake: hb }, Math.round(dSec / dt), dt);
}

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);

describe('stepCar handbrake', () => {
  it('exposes slip and skidding: straight driving has no slip, a drift does', () => {
    const straight = runFrames(createCar({ x: 0, z: 0 }), gas, 120, 1 / 60);
    expect(straight.slip).toBeLessThan(1e-9);
    expect(straight.skidding).toBe(false);

    const car = drift(1 / 60, 1.5, 0.4, 1);
    expect(car.slip).toBeGreaterThan(1);
    expect(car.skidding).toBe(true);
  });

  it('handbrake slip > normal slip: lowered lateral grip lets the tail out', () => {
    // short drift, before handDrag bleeds the speed that feeds slip
    const normal = drift(1 / 60, 1.5, 0.25, 0);
    const hand = drift(1 / 60, 1.5, 0.25, 1);
    expect(hand.slip).toBeGreaterThan(normal.slip);
    expect(hand.slip / Math.hypot(hand.vx, hand.vz)).toBeGreaterThan((1.5 * normal.slip) / Math.hypot(normal.vx, normal.vz));
    expect(C.handGrip).toBeLessThan(C.grip);
  });

  it('extra yaw: same steer turns harder under handbrake', () => {
    const normal = drift(1 / 60, 1.5, 0.8, 0);
    const hand = drift(1 / 60, 1.5, 0.8, 1);
    expect(hand.heading).toBeGreaterThan(normal.heading * 1.1);
  });

  it('extra drag: handbrake coasts down faster than free coast', () => {
    const coast = runFrames(drift0(), idle, 60, 1 / 60);
    const hand = runFrames(drift0(), { ...idle, handbrake: 1 }, 60, 1 / 60);
    expect(Math.hypot(hand.vx, hand.vz)).toBeLessThan(Math.hypot(coast.vx, coast.vz));
  });

  it('frame-rate independent: 60 Hz vs 144 Hz agree within 2%', () => {
    const a = drift(1 / 60, 1.5, 1.2, 1);
    const b = drift(1 / 144, 1.5, 1.2, 1);
    expect(rel(a.x, b.x)).toBeLessThan(0.02);
    expect(rel(a.z, b.z)).toBeLessThan(0.02);
    expect(rel(a.speed, b.speed)).toBeLessThan(0.02);
    expect(rel(a.heading, b.heading)).toBeLessThan(0.02);
  });
});

function drift0() {
  return runFrames(createCar({ x: 0, z: 0 }), gas, 90, 1 / 60); // ~15 m/s straight
}
