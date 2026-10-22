import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';

const DT = 1 / 60;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const gas = { ...idle, throttle: 1 };

function run(world, controls, seconds, dt = DT) {
  for (let t = 0; t < seconds; t += dt) stepGame(world, controls, dt);
  return world;
}

const horns = (world) => world.events.filter((e) => e.type === 'horn').length;

// The car spawns on the town's centre road, so driving is measured as displacement from there.
const dx = (w) => w.car.x - w.town.spawn.x;
const dz = (w) => w.car.z - w.town.spawn.z;

describe('createGame', () => {
  it('starts parked at the town spawn with an empty event queue', () => {
    const w = createGame();
    expect(w.car.x).toBe(w.town.spawn.x);
    expect(w.car.z).toBe(w.town.spawn.z);
    expect(w.car.heading).toBe(w.town.spawn.heading);
    expect(w.car.speed).toBe(0);
    expect(w.events).toEqual([]);
    expect(w.pose).toBeNull(); // nothing computed until the first step
  });
});

describe('stepGame driving', () => {
  it('throttle drives the car forward along its heading', () => {
    const w = run(createGame(), gas, 1);
    expect(w.car.speed).toBeGreaterThan(0);
    expect(dz(w)).toBeGreaterThan(0); // heading 0 faces +z
    expect(Math.abs(dx(w))).toBeLessThan(1e-12);
    expect(w.car.heading).toBeCloseTo(w.town.spawn.heading, 12); // straight ahead, no pivot
  });

  it('stays parked with no input', () => {
    const w = run(createGame(), idle, 2);
    expect(w.car.x).toBe(w.town.spawn.x);
    expect(w.car.z).toBe(w.town.spawn.z);
    expect(w.events).toEqual([]);
  });

  it('clamps dt to 0.05 s, so a long frame is one slow frame not a teleport', () => {
    const hitch = createGame();
    stepGame(hitch, gas, 10);
    const slow = createGame();
    stepGame(slow, gas, 0.05);
    expect(hitch.car.z).toBeCloseTo(slow.car.z, 12);
    expect(dz(hitch)).toBeLessThan(CONFIG.car.maxSpeed * 0.05 + 1e-9);
  });
});

describe('stepGame events', () => {
  it('clears the queue at the start of every step', () => {
    const w = createGame();
    w.events.push({ type: 'impact', speed: 5 });
    stepGame(w, idle, DT);
    expect(w.events).toEqual([]);
  });

  it('emits one horn event per press, not one per frame while held', () => {
    const w = createGame();
    stepGame(w, { ...idle, horn: 1 }, DT);
    expect(horns(w)).toBe(1);
    stepGame(w, { ...idle, horn: 1 }, DT);
    stepGame(w, { ...idle, horn: 1 }, DT);
    expect(horns(w)).toBe(0); // still held: silent

    stepGame(w, idle, DT); // released
    expect(horns(w)).toBe(0);
    stepGame(w, { ...idle, horn: 1 }, DT); // pressed again
    expect(horns(w)).toBe(1);
  });
});

describe('stepGame camera', () => {
  it('poses the camera behind the car and follows it down the road', () => {
    const w = createGame();
    stepGame(w, gas, DT);
    const behind = Math.cos(CONFIG.cam.pitch0) * CONFIG.cam.dist;
    expect(w.pose.z).toBeCloseTo(w.car.z - behind, 6); // heading 0 faces +z, camera behind
    expect(w.pose.y).toBeGreaterThanOrEqual(0.9);

    run(w, gas, 3);
    expect(w.pose.z).toBeGreaterThan(1); // came along with the car
    const gap = Math.hypot(w.pose.x - w.car.x, w.pose.z - w.car.z);
    expect(gap).toBeGreaterThanOrEqual(behind - 1e-6); // never cut in to the car
    expect(gap).toBeLessThan(CONFIG.cam.maxDist); // never lost down the road
  });

  it('takes orbit and zoom from controls', () => {
    const o = createGame();
    stepGame(o, { ...idle, orbit: { yaw: 0.5, pitch: 0 } }, DT);
    expect(o.cam.yaw).toBeCloseTo(0.5, 6);

    const z = createGame();
    stepGame(z, { ...idle, zoom: -4 }, DT);
    expect(z.cam.dist).toBeCloseTo(CONFIG.cam.dist - 4, 6);
  });

  it('widens fov with speed', () => {
    const w = run(createGame(), gas, 3);
    expect(w.cam.fov).toBeGreaterThan(CONFIG.cam.fov);
  });
});
