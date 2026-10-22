// T45 — body lean: spring-damped chassis pitch from longitudinal accel, roll from lateral.
import { describe, it, expect } from 'vitest';
import { createCar, stepCar } from '../src/car.js';
import { buildCarMesh, updateCarMesh } from '../src/render/carMesh.js';

const DT = 1 / 60;
const NO_INPUT = { throttle: 0, brake: 0, handbrake: 0, steer: 0 };
const newCar = (over) => Object.assign(createCar({ x: 0, z: 0, heading: 0 }), over);
const drive = (car, input, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepCar(car, { ...NO_INPUT, ...input }, DT);
};

describe('chassis lean', () => {
  it('is level at rest and stays level', () => {
    const car = newCar();
    drive(car, {}, 1);
    expect(car.pitch).toBe(0);
    expect(car.roll).toBe(0);
  });

  it('lifts the nose under throttle', () => {
    const car = newCar();
    drive(car, { throttle: 1 }, 0.3);
    expect(car.speed).toBeGreaterThan(1);
    expect(car.pitch).toBeLessThan(-0.02); // -x = nose up
  });

  it('dives the nose under braking', () => {
    const car = newCar();
    drive(car, { throttle: 1 }, 2);
    expect(car.pitch).toBeLessThan(0);
    drive(car, { brake: 1 }, 0.5);
    expect(car.pitch).toBeGreaterThan(0.02); // +x = nose down
  });

  it('rolls to the outside of a corner, both ways', () => {
    const left = newCar();
    drive(left, { throttle: 1, steer: 1 }, 1.2);
    expect(left.roll).toBeGreaterThan(0.03); // a left turn lifts the left side (+z)
    const right = newCar();
    drive(right, { throttle: 1, steer: -1 }, 1.2);
    expect(right.roll).toBeLessThan(-0.03);
  });

  it('settles back to level once the car stops', () => {
    const car = newCar();
    drive(car, { throttle: 1, steer: 0.5 }, 1.5);
    drive(car, {}, 6); // coast to a standstill, then let the springs ring out
    expect(Math.abs(car.speed)).toBeLessThan(0.01);
    expect(Math.abs(car.pitch)).toBeLessThan(0.002);
    expect(Math.abs(car.roll)).toBeLessThan(0.002);
  });

  it('stays bounded at the worst frame rate', () => {
    const car = newCar();
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      const hard = i >= 150;
      stepCar(car, { ...NO_INPUT, throttle: hard ? 0 : 1, brake: hard ? 1 : 0, steer: hard ? 0.6 : 0 }, 0.05);
      peak = Math.max(peak, Math.abs(car.pitch), Math.abs(car.roll));
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThan(0.25); // the springs never blow up at the 0.05 s dt clamp
  });
});

describe('carMesh lean', () => {
  it('leans the body, cabin, bumpers and lamps together on the chassis', () => {
    const m = buildCarMesh();
    updateCarMesh(m, newCar({ pitch: -0.06, roll: 0.05 }), DT);
    expect(m.chassis.rotation.x).toBeCloseTo(-0.06, 9);
    expect(m.chassis.rotation.z).toBeCloseTo(0.05, 9);
    expect(m.body.parent).toBe(m.chassis);
    expect(m.cabin.parent).toBe(m.chassis);
    expect(m.chassis.children.length).toBe(2 + 2 + 4); // body, cabin, 2 bumpers, 2 head + 2 tail
  });

  it('treats a car without lean state (traffic) as level, not NaN', () => {
    const m = buildCarMesh();
    updateCarMesh(m, { x: 0, z: 0, heading: 0, speed: 5, steer: 0 }, DT);
    expect(m.chassis.rotation.x).toBe(0);
    expect(m.chassis.rotation.z).toBe(0);
  });

  it('keeps the wheels on the ground', () => {
    const m = buildCarMesh();
    updateCarMesh(m, newCar({ pitch: -0.06, roll: 0.05 }), DT);
    for (const w of m.wheels) expect(w.rotation.x).toBe(0);
    for (const s of m.steers) expect(s.rotation.x).toBe(0);
  });
});
