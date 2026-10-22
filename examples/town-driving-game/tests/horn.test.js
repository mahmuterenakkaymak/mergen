// T47: horn reactions. A blast within 12 m makes a walker flinch and step off the car's
// side, and the nearest AI car dead ahead within 15 m toots back on a lower pitch — once
// every 2 s, so a held horn never turns the whole street into a chase scene.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame, stepGame } from '../src/game.js';
import { stepPeds, startlePeds } from '../src/peds.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, '..', 'src', f), 'utf8');

const DT = 1 / 60;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const blast = { ...idle, horn: 1 };

const mkPed = (over) => ({
  axis: 'x', dir: 1, lo: -30, hi: 30, cross: 0,
  x: 0, z: 0, phase: 0, panic: 0, flinch: 0, color: 0xef476f, ...over,
});
const mkCar = (over) => ({ x: 0, z: 0, speed: 0, ...over });
// Parked on its loop: a test that counts the 2 s cooldown cannot have the car drive off.
const mkAi = (over) => ({
  x: 0, z: 0, heading: 0, speed: 0, cruise: 0, wp: 1,
  waypoints: [{ x: 0, z: -100 }, { x: 0, z: 100 }, { x: 100, z: 100 }, { x: 100, z: -100 }],
  color: 0x3a86ff, ...over,
});

// The crossroads the road centre lines make at the origin, facing +z. Every case below
// stages its own actors around it rather than hoping the seeded crowd is in earshot.
function street() {
  const w = createGame();
  w.peds.length = 0;
  w.traffic.length = 0;
  Object.assign(w.car, { x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0 });
  return w;
}

// H for one frame, released the next, so the following honk is a fresh edge.
function honk(world) {
  const all = [];
  for (const controls of [blast, idle]) {
    stepGame(world, controls, DT);
    all.push(...world.events);
  }
  return all;
}

const run = (world, seconds) => {
  const all = [];
  for (let t = 0; t < seconds; t += DT) {
    stepGame(world, idle, DT);
    all.push(...world.events);
  }
  return all;
};

const heard = (events, type) => events.filter((e) => e.type === type);
const dist = (p, c) => Math.hypot(p.x - c.x, p.z - c.z);

describe('a blast and the walkers', () => {
  it('flinches a walker within 12 m of the horn', () => {
    const p = mkPed({ x: 11.9, z: 0 });
    startlePeds([p], mkCar());
    expect(p.flinch).toBeGreaterThan(0);
  });

  it('leaves a walker across the street alone', () => {
    const p = mkPed({ x: 13, z: 0 });
    startlePeds([p], mkCar());
    expect(p.flinch).toBe(0);
  });

  it('quits its stride and steps away from the car it heard', () => {
    const p = mkPed({ x: 6, dir: -1 }); // walking at the parked car, so only a flinch moves it off
    const car = mkCar();
    startlePeds([p], car);
    const d0 = dist(p, car);
    for (let i = 0; i < 30; i++) stepPeds([p], car, DT);
    expect(dist(p, car)).toBeGreaterThan(d0 + 0.6); // half a second of a fading sidestep
  });

  it('steps off the pavement line towards the kerb, never past it', () => {
    const p = mkPed({ x: 0, z: 0 });
    const car = mkCar({ z: 5 }); // on the road, abeam the walker
    startlePeds([p], car);
    for (let i = 0; i < 30; i++) {
      stepPeds([p], car, DT);
      expect(Math.abs(p.z - p.cross)).toBeLessThanOrEqual(1.2);
    }
    expect(p.z).toBeLessThan(-0.5); // it got off the car's side
  });

  it('is only a startle: a horn heard, not a car felt, sends nobody running', () => {
    const p = mkPed({ x: 8, z: 0 });
    const car = mkCar({ speed: 12 });
    startlePeds([p], car);
    expect(stepPeds([p], car, DT)).toEqual([]);
    expect(p.panic).toBe(0);
  });

  it('flinches the walkers in earshot of a real blast, and only them', () => {
    const w = street();
    w.peds.push(mkPed({ x: 5, z: 3 }), mkPed({ x: -20, z: 0 }));
    honk(w);
    expect(w.peds[0].flinch).toBeGreaterThan(0);
    expect(w.peds[1].flinch).toBe(0);
  });
});

describe('the car ahead answers', () => {
  it('toots back from a car dead ahead within 15 m, on a lower pitch', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 0, z: 10 }));
    const back = heard(honk(w), 'hornBack');
    expect(back).toHaveLength(1);
    expect(back[0].pitch).toBeLessThan(1);
    expect(back[0].pitch).toBeGreaterThan(0);
  });

  it('says nothing to a car behind it', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 0, z: -10 }));
    expect(heard(honk(w), 'hornBack')).toHaveLength(0);
  });

  it('says nothing to a car pulled up alongside', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 9, z: 0 }));
    expect(heard(honk(w), 'hornBack')).toHaveLength(0);
  });

  it('says nothing to a car the length of a block away', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 0, z: 20 }));
    expect(heard(honk(w), 'hornBack')).toHaveLength(0);
  });

  it('answers once per blast, not once per car in earshot', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 0, z: 12 }), mkAi({ x: 4, z: 8 }), mkAi({ x: -3, z: 14 }));
    expect(heard(honk(w), 'hornBack')).toHaveLength(1);
  });

  it('waits 2 s before it answers again', () => {
    const w = street();
    w.traffic.push(mkAi({ x: 0, z: 10 }));
    expect(heard(honk(w), 'hornBack')).toHaveLength(1);
    run(w, 1.4);
    expect(heard(honk(w), 'hornBack')).toHaveLength(0);
    run(w, 1.2);
    expect(heard(honk(w), 'hornBack')).toHaveLength(1);
  });

  it("still sounds the player's own horn when nobody is left to answer", () => {
    const w = street();
    const events = honk(w);
    expect(heard(events, 'horn')).toHaveLength(1);
    expect(heard(events, 'hornBack')).toHaveLength(0);
  });
});

describe('the frame loop', () => {
  it('voices the answer through the horn at the pitch the sim asked for', () => {
    expect(read('main.js')).toMatch(/e\.type === 'hornBack'\)\s*audio\.horn\(e\.pitch\)/);
  });
});
