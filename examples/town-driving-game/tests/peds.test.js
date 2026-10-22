import { describe, it, expect } from 'vitest';
import { makePeds, stepPeds } from '../src/peds.js';
import { generateTown } from '../src/town.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const town = generateTown(CONFIG.seed, CONFIG);
const pedsRng = () => createRng(CONFIG.seed).fork('peds');
const FAR = { x: 1e6, z: 1e6, speed: 0 }; // car nowhere near, so a walker just paces

// A walker pacing the x axis along the z = 0 sidewalk line, its block ends at ±10.
const mkPed = (over) => ({
  axis: 'x', dir: 1, lo: -10, hi: 10, cross: 0,
  x: 0, z: 0, phase: 0, panic: 0, color: 0xef476f, ...over,
});
const mkCar = (over) => ({ x: 0, z: 0, speed: 0, ...over });
const dist = (p, c) => Math.hypot(p.x - c.x, p.z - c.z);

const onRoad = (p) =>
  town.roads.some((r) => Math.abs(p.x - r) <= CONFIG.road / 2) ||
  town.roads.some((r) => Math.abs(p.z - r) <= CONFIG.road / 2);

// Across the street it walks along, 1.4 m inside a block edge: the kerb-side line of
// the sidewalk slab.
const onSidewalkLine = (p) => {
  const u = p.axis === 'x' ? p.z : p.x;
  return town.blocks.some((b) => {
    const lo = (p.axis === 'x' ? b.z : b.x) + 1.4;
    const hi = (p.axis === 'x' ? b.z + b.h : b.x + b.w) - 1.4;
    return Math.abs(u - lo) < 0.01 || Math.abs(u - hi) < 0.01;
  });
};

describe('makePeds', () => {
  it('spawns the configured number of walkers', () => {
    expect(makePeds(pedsRng(), town)).toHaveLength(CONFIG.peds.count);
  });

  it('puts every walker on a sidewalk line, never in the road', () => {
    for (const p of makePeds(pedsRng(), town)) {
      expect(onRoad(p)).toBe(false);
      expect(onSidewalkLine(p)).toBe(true);
      const b = town.bounds;
      expect(p.x).toBeGreaterThan(b.minX);
      expect(p.x).toBeLessThan(b.maxX);
      expect(p.z).toBeGreaterThan(b.minZ);
      expect(p.z).toBeLessThan(b.maxZ);
    }
  });

  it('gives each walker a block edge to pace and a colour to wear', () => {
    for (const p of makePeds(pedsRng(), town)) {
      const along = p.axis === 'x' ? p.x : p.z;
      const cross = p.axis === 'x' ? p.z : p.x;
      expect(p.lo).toBeLessThan(p.hi);
      expect(along).toBeGreaterThanOrEqual(p.lo);
      expect(along).toBeLessThanOrEqual(p.hi);
      expect(cross).toBe(p.cross);
      expect([1, -1]).toContain(p.dir);
      expect(Number.isFinite(p.phase)).toBe(true);
      expect(CONFIG.colors.peds).toContain(p.color);
    }
  });

  it('is deterministic for a seed and differs for another', () => {
    const a = makePeds(pedsRng(), town);
    const b = makePeds(pedsRng(), town);
    expect(a).toEqual(b);
    const other = makePeds(createRng(CONFIG.seed + 1).fork('peds'), town);
    expect(other.map((p) => p.x)).not.toEqual(a.map((p) => p.x));
  });
});

describe('stepPeds', () => {
  it('paces its block edge and turns around at both ends', () => {
    const p = mkPed({ x: 9.5, dir: 1 });
    for (let i = 0; i < 240; i++) stepPeds([p], FAR, 1 / 60);
    expect(p.dir).toBe(-1); // bounced off the far end
    expect(p.z).toBe(0); // stayed on its line
    for (let i = 0; i < 1200; i++) stepPeds([p], FAR, 1 / 60);
    expect(p.dir).toBe(1); // and off the near end too
    expect(p.x).toBeGreaterThanOrEqual(p.lo);
  });

  it('advances the walk phase, faster in a panic', () => {
    const walk = mkPed();
    const run = mkPed({ panic: 1 });
    stepPeds([walk], FAR, 1 / 60);
    stepPeds([run], FAR, 1 / 60);
    expect(walk.phase).toBeGreaterThan(0);
    expect(run.phase).toBeGreaterThan(walk.phase);
  });

  it('panics and cries watchOut when a moving car clips it', () => {
    const p = mkPed();
    const car = mkCar({ x: 1, speed: 12 });
    expect(stepPeds([p], car, 1 / 60)).toEqual([{ type: 'watchOut', x: p.x, z: p.z }]);
    expect(p.panic).toBeGreaterThan(0);
  });

  it('is shoved clear of the car radius', () => {
    const p = mkPed();
    const car = mkCar({ x: 0.5, speed: 12 });
    stepPeds([p], car, 1 / 60);
    expect(dist(p, car)).toBeGreaterThanOrEqual(CONFIG.car.radius + 0.45 - 1e-6);
  });

  it('runs away from the car while panicked, faster than it walks', () => {
    const p = mkPed();
    const car = mkCar({ x: 1, speed: 12 });
    stepPeds([p], car, 1 / 60); // the clip
    const d0 = dist(p, car);
    for (let i = 0; i < 30; i++) stepPeds([p], car, 1 / 60);
    expect(dist(p, car)).toBeGreaterThan(d0 + 1.5); // half a second of a 4.2 m/s sprint
  });

  it('leaves a slow car alone: shoved off, but no panic and no watchOut', () => {
    const p = mkPed();
    const car = mkCar({ x: 1, speed: 2 });
    expect(stepPeds([p], car, 1 / 60)).toEqual([]);
    expect(p.panic).toBe(0);
    expect(dist(p, car)).toBeGreaterThanOrEqual(CONFIG.car.radius + 0.45 - 1e-6);
  });

  it('cries watchOut once per clip, not once per frame', () => {
    const p = mkPed({ lo: -50, hi: 50 });
    const car = mkCar({ x: -1, speed: 12 });
    let calls = 0;
    for (let i = 0; i < 120; i++) {
      car.x = p.x - 1; // the car keeps pace, riding along the pavement
      calls += stepPeds([p], car, 1 / 60).filter((e) => e.type === 'watchOut').length;
    }
    expect(calls).toBe(1);
  });

  it('keeps a panicking walker on its sidewalk and in the world', () => {
    const p = mkPed({ lo: -6, hi: 6 });
    const car = mkCar({ x: 0, z: -1.6, speed: 12 }); // parked at the kerb, clipping the line
    const b = town.bounds;
    for (let i = 0; i < 60 * 30; i++) {
      stepPeds([p], car, 1 / 60);
      expect(Math.abs(p.z - p.cross)).toBeLessThan(3); // darted off the line, never onto the road
      expect(p.x).toBeGreaterThanOrEqual(p.lo);
      expect(p.x).toBeLessThanOrEqual(p.hi);
      expect(p.x).toBeGreaterThan(b.minX);
      expect(p.x).toBeLessThan(b.maxX);
    }
  });
});
