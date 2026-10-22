import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCar, stepCar } from '../src/car.js';
import { createGame, stepGame } from '../src/game.js';
import { generateTown } from '../src/town.js';
import { createRng } from '../src/util/rng.js';
import { createInputState, keyDown, toControls } from '../src/input.js';

// Headless run of the brief's acceptance tests 3-6 (PROJECT_BRIEF.md §9): the shipped
// arcade car model, the wired game loop and the seeded generator, driven with no browser.

const C = CONFIG.car;
const DT = 1 / 60;
const NEAR = 0.05; // m/s tolerance for "at maxSpeed"
const R = C.radius;

// Controls straight from the real key map, so "holding W" is literally KeyW -> throttle.
function keys(...codes) {
  const s = createInputState();
  for (const code of codes) keyDown(s, { code, repeat: false });
  return toControls(s);
}
const GAS = keys('KeyW');
const BRAKE = keys('KeyS');

function run(car, controls, seconds, dt = DT) {
  for (let t = 0; t < seconds; t += dt) stepCar(car, controls, dt);
  return car;
}

// Gap from a point to the box face: 0 on the surface, >= R clears it with the car circle.
function faceGap(x, z, box) {
  const dx = Math.max(box.minX - x, x - box.maxX, 0);
  const dz = Math.max(box.minZ - z, z - box.maxZ, 0);
  return Math.hypot(dx, dz);
}

// Brief test 3: W builds 0 -> max over ~3-4 s, releasing coasts down, S stops then reverses.
describe('acceptance 3 — speed build-up, coast and reverse', () => {
  for (const hz of [60, 144]) {
    it(`W takes the car 0 -> maxSpeed in 3-4 s at ${hz} Hz, never past it`, () => {
      const car = createCar({ x: 0, z: 0 });
      let t = 0;
      while (car.speed < C.maxSpeed - NEAR && t < 20) {
        stepCar(car, GAS, 1 / hz);
        t += 1 / hz;
      }
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(4);
      expect(Math.hypot(car.vx, car.vz)).toBeLessThanOrEqual(C.maxSpeed + 1e-9);
    });
  }

  it('releasing W decays speed gradually to a stop', () => {
    const car = run(createCar({ x: 0, z: 0 }), GAS, 5);
    const v0 = car.speed;
    stepCar(car, keys(), DT);
    expect(car.speed).toBeGreaterThan(v0 * 0.9); // one frame shaves a slice, not everything
    let t = 0;
    while (car.speed > 0 && t < 12) {
      stepCar(car, keys(), DT);
      t += DT;
    }
    expect(car.speed).toBe(0);
    expect(t).toBeGreaterThan(1); // a gradual coast, not a brake
  });

  it('S brakes a moving car to a stop, then reverses slower than forward max', () => {
    const car = run(createCar({ x: 0, z: 0 }), GAS, 1);
    const v0 = car.speed;
    run(car, BRAKE, 0.5);
    expect(car.speed).toBeLessThan(v0 * 0.1); // stopped first
    run(car, BRAKE, 1.5);
    expect(car.speed).toBeLessThan(0); // ...then in reverse
    expect(Math.abs(car.speed)).toBeLessThan(C.maxSpeed);
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(C.reverseMax + C.accel * DT);
    expect(C.reverseMax).toBeLessThan(C.maxSpeed);
  });
});

// Brief test 4: steering turns the car at speed, does nothing at standstill, A/D mirror.
describe('acceptance 4 — steering', () => {
  it('steering at speed turns the car', () => {
    const car = run(createCar({ x: 0, z: 0 }), GAS, 2); // ~21 m/s, full turn authority
    const h0 = car.heading;
    run(car, keys('KeyW', 'KeyA'), 0.4);
    expect(Math.abs(car.heading - h0)).toBeGreaterThan(0.1);
  });

  it('no pivoting at standstill: full steer changes nothing', () => {
    const car = run(createCar({ x: 5, z: -2 }), keys('KeyA'), 2);
    expect(car.heading).toBe(0);
    expect(car.x).toBe(5);
    expect(car.z).toBe(-2);
  });

  it('A and D mirror each other', () => {
    const drive = (k) => {
      const car = run(createCar({ x: 0, z: 0 }), keys('KeyW', k), 1);
      return { dh: car.heading, x: car.x };
    };
    const left = drive('KeyA');
    const right = drive('KeyD');
    expect(left.dh).toBeGreaterThan(0);
    expect(left.dh).toBeCloseTo(-right.dh, 6);
    expect(left.x).toBeGreaterThan(0);
    expect(left.x).toBeCloseTo(-right.x, 6);
  });
});

// Brief test 5: a full-speed hit stops at the wall face; the car never ends inside a box
// or outside the world bounds, however it is driven.
describe('acceptance 5 — collision', () => {
  it('a full-speed hit stops the car at the building face', () => {
    const w = createGame();
    const box = w.town.aabbs[0]; // buildings come first in the collider list
    const car = w.car;
    car.x = (box.minX + box.maxX) / 2;
    car.z = box.minZ - R - 3;
    car.heading = 0; // faces +z, straight at the wall
    car.vz = C.maxSpeed; // a 3 m runway is too short to accelerate down

    let impact = null;
    for (let t = 0; t < 2; t += DT) {
      stepGame(w, GAS, DT);
      expect(faceGap(car.x, car.z, box)).toBeGreaterThanOrEqual(R - 1e-6); // never inside
      if (!impact) impact = w.events.find((e) => e.type === 'impact') ?? null;
    }

    expect(impact).toBeTruthy();
    expect(impact.speed).toBeGreaterThan(25); // hit at near full speed
    expect(car.speed).toBeLessThan(0.5); // pinned at the wall, not revving
    expect(faceGap(car.x, car.z, box)).toBeLessThan(R + 0.05); // stopped at the face
  });

  it('seeded random-input runs never end inside a box or outside the bounds', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRng(seed);
      const w = createGame();
      for (let i = 0; i < 150; i++) {
        stepGame(w, {
          throttle: rng.float() < 0.75 ? 1 : 0,
          brake: rng.float() < 0.1 ? 1 : 0,
          steer: rng.range(-1, 1),
          handbrake: rng.float() < 0.08 ? 1 : 0,
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

// Brief test 6: the generator is deterministic — same seed, identical town; other seed, differs.
describe('acceptance 6 — same seed, same town', () => {
  it('two runs of the same seed produce identical layouts', () => {
    expect(JSON.stringify(generateTown(CONFIG.seed))).toBe(JSON.stringify(generateTown(CONFIG.seed)));
    expect(JSON.stringify(generateTown(4242))).toBe(JSON.stringify(generateTown(4242)));
  });

  it('a different seed produces a different town', () => {
    expect(JSON.stringify(generateTown(CONFIG.seed + 1))).not.toBe(JSON.stringify(generateTown(CONFIG.seed)));
  });
});
