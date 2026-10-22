import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { clampToBounds, resolveCircleCircle, resolveWorld } from '../src/collision.js';

const R = CONFIG.car.radius;
const MAX = CONFIG.car.maxSpeed;
const BOUNDS = { minX: -100, maxX: 100, minZ: -80, maxZ: 80 };

const v = (x, z) => ({ x, z });
const len = (a) => Math.hypot(a.x, a.z);
const mkCar = (x, z, vx = 0, vz = 0) => ({ x, z, vx, vz, heading: 0, speed: Math.hypot(vx, vz) });
// stepCar has already moved the car by vx*dt when resolveWorld runs; this is that state.
const driven = (x0, z0, vx, vz, dt) => mkCar(x0 + vx * dt, z0 + vz * dt, vx, vz);
const townOf = (aabbs, bounds = BOUNDS) => ({ bounds, aabbs });
const BUILDING = { minX: 20, maxX: 40, minZ: -10, maxZ: 10 };
const THIN_WALL = { minX: 20, maxX: 20.3, minZ: -30, maxZ: 30 }; // 0.3 m slab: a whole frame step is longer than it
const closestOn = (b, p) => v(Math.min(Math.max(p.x, b.minX), b.maxX), Math.min(Math.max(p.z, b.minZ), b.maxZ));
const gap = (b, p) => { const c = closestOn(b, p); return len(v(p.x - c.x, p.z - c.z)); };
const body = (x, z, r, mass, vel = v(0, 0)) => ({ pos: v(x, z), vel, r, mass });

describe('clampToBounds', () => {
  it('leaves a circle that already fits alone and says so', () => {
    const p = v(0, 0);
    expect(clampToBounds(p, R, BOUNDS)).toBe(false);
    expect(p).toEqual({ x: 0, z: 0 });

    // Exactly tangent to the -X boundary is still inside.
    const t = v(BOUNDS.minX + R, 0);
    expect(clampToBounds(t, R, BOUNDS)).toBe(false);
    expect(t.x).toBe(BOUNDS.minX + R);
  });

  it('pulls a circle back until its rim touches the boundary', () => {
    const p = v(BOUNDS.maxX + 5, 12);
    expect(clampToBounds(p, R, BOUNDS)).toBe(true);
    expect(p.x).toBeCloseTo(BOUNDS.maxX - R, 12);
    expect(p.z).toBeCloseTo(12, 12); // the other axis stays put
  });

  it('clamps a corner on both axes', () => {
    const p = v(BOUNDS.maxX + 1, BOUNDS.minZ - 3);
    expect(clampToBounds(p, R, BOUNDS)).toBe(true);
    expect(p.x).toBeCloseTo(BOUNDS.maxX - R, 12);
    expect(p.z).toBeCloseTo(BOUNDS.minZ + R, 12);
  });

  it('does not touch the bounds', () => {
    const b = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    clampToBounds(v(50, 50), R, b);
    expect(b).toEqual({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
  });
});

describe('resolveCircleCircle', () => {
  it('leaves two circles that miss each other alone and reports no contact', () => {
    const a = body(0, 0, 1, 1, v(3, 0));
    const b = body(4, 0, 1, 1, v(0, 0));
    expect(resolveCircleCircle(a, b)).toBeNull();
    expect(a.pos).toEqual({ x: 0, z: 0 });
    expect(b.pos).toEqual({ x: 4, z: 0 });
    expect(a.vel).toEqual({ x: 3, z: 0 });
    expect(b.vel).toEqual({ x: 0, z: 0 });
  });

  it('splits the push by inverse mass, the lighter body giving way', () => {
    const a = body(0, 0, 1, 3, v(5, 0)); // 0.5 m overlap
    const b = body(1.5, 0, 1, 1);
    const res = resolveCircleCircle(a, b);
    // 0.5 m of penetration in a 1:3 ratio (mass 3:1).
    expect(a.pos.x).toBeCloseTo(-0.125, 9);
    expect(b.pos.x).toBeCloseTo(1.875, 9);
    expect(len(v(b.pos.x - a.pos.x, b.pos.z - a.pos.z))).toBeCloseTo(2, 9);
    // Momentum conserved: 3*5 = (3+1)*3.75, and both land on the same normal speed.
    expect(a.vel.x).toBeCloseTo(3.75, 9);
    expect(b.vel.x).toBeCloseTo(3.75, 9);
    expect(res.impact).toBeCloseTo(5, 9);
    expect(res.normal).toEqual({ x: 1, z: 0 });
    expect(res.contact.x).toBeCloseTo(a.pos.x + 1, 9);
  });

  it('splits an equal-mass hit down the middle', () => {
    const a = body(0, 0, 1, 1, v(10, 10));
    const b = body(0, 1.6, 1, 1, v(-10, -10));
    const res = resolveCircleCircle(a, b);
    expect(a.pos.z).toBeCloseTo(-0.2, 9);
    expect(b.pos.z).toBeCloseTo(1.8, 9);
    expect(res.impact).toBeCloseTo(20, 9);
    // Perfectly inelastic along the normal, untouched along the tangent.
    expect(a.vel).toEqual({ x: 10, z: 0 });
    expect(b.vel).toEqual({ x: -10, z: 0 });
  });

  it('never moves a massless body', () => {
    const a = body(0, 0, 1, 0);
    const b = body(1.2, 0, 1, 1, v(-4, 0));
    const res = resolveCircleCircle(a, b);
    expect(a.pos).toEqual({ x: 0, z: 0 });
    expect(a.vel).toEqual({ x: 0, z: 0 });
    expect(b.pos.x).toBeCloseTo(2, 9); // takes the whole 0.8 m push
    expect(b.vel.x).toBeCloseTo(0, 9);
    expect(res.impact).toBeCloseTo(4, 9);
  });

  it('pushes apart without taking speed back from circles already separating', () => {
    const a = body(0, 0, 1, 1, v(-6, 0));
    const b = body(1.8, 0, 1, 1, v(6, 0));
    const res = resolveCircleCircle(a, b);
    expect(res.impact).toBe(0);
    expect(a.vel).toEqual({ x: -6, z: 0 });
    expect(b.vel).toEqual({ x: 6, z: 0 });
    expect(b.pos.x - a.pos.x).toBeCloseTo(2, 9);
  });

  it('separates concentric circles instead of dividing by zero', () => {
    const a = body(3, 5, 1, 1);
    const b = body(3, 5, 1, 1);
    const res = resolveCircleCircle(a, b);
    expect(Number.isFinite(a.pos.x) && Number.isFinite(b.pos.z)).toBe(true);
    expect(len(v(b.pos.x - a.pos.x, b.pos.z - a.pos.z))).toBeCloseTo(2, 9);
    expect(res.impact).toBe(0);
  });

  it('reports no contact when two massless circles overlap', () => {
    expect(resolveCircleCircle(body(0, 0, 1, 0), body(0.5, 0, 1, 0))).toBeNull();
  });

  it('never leaves two circles overlapping or still closing', () => {
    const bad = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const d = 1 + (i % 7) * 0.2; // 1..2.2 m apart, r sums to 2 => overlapping
      const A = body(0, 0, 1, [0, 1, 4][i % 3], v(Math.cos(a) * 9, Math.sin(a) * 9));
      const B = body(Math.cos(a) * d, Math.sin(a) * d, 1, [1, 3, 0][i % 3], v(-Math.cos(a) * 7, -Math.sin(a) * 7));
      const res = resolveCircleCircle(A, B);
      const why = { a: a.toFixed(3), d };
      if (!res) continue; // d >= 2: they miss, nothing to fix
      const sep = len(v(B.pos.x - A.pos.x, B.pos.z - A.pos.z));
      if (!Number.isFinite(sep)) bad.push({ ...why, why: 'NaN position' });
      else if (A.mass > 0 && B.mass > 0 && sep < 2 - 1e-9) bad.push({ ...why, why: 'still overlapping' });
      const rvn = (B.vel.x - A.vel.x) * Math.cos(a) + (B.vel.z - A.vel.z) * Math.sin(a);
      if (rvn < -1e-9) bad.push({ ...why, why: 'still closing' });
    }
    expect(bad).toEqual([]);
  });
});

describe('resolveWorld', () => {
  it('walks free driving exactly as far as the frame asked', () => {
    const car = driven(0, 0, 20, -5, 0.05);
    const res = resolveWorld(car, townOf([]), 0.05);
    expect(car.x).toBeCloseTo(1, 9);
    expect(car.z).toBeCloseTo(-0.25, 9);
    expect(car.vx).toBeCloseTo(20, 12);
    expect(car.vz).toBeCloseTo(-5, 12);
    expect(res).toBeNull();
  });

  it('stops a full-speed car at a building face and reports the hardest hit', () => {
    const car = driven(17.45, 0, MAX, 0, 0.05);
    const res = resolveWorld(car, townOf([BUILDING]), 0.05);
    expect(car.x).toBeCloseTo(20 - R, 9);
    expect(car.vx).toBeCloseTo(0, 9);
    expect(res.impact).toBeCloseTo(MAX, 9);
    expect(res.normal).toEqual({ x: -1, z: 0 });
    expect(res.contact.x).toBeCloseTo(20, 9);
    expect(res.contact.z).toBeCloseTo(0, 9);
  });

  it('keeps the tangential speed so a glancing hit slides along the face', () => {
    const car = driven(17.75, 0, 20, 12, 0.05);
    resolveWorld(car, townOf([BUILDING]), 0.05);
    expect(car.x).toBeCloseTo(20 - R, 9);
    expect(car.vx).toBeCloseTo(0, 9);
    expect(car.vz).toBeCloseTo(12, 9);
    expect(car.z).toBeCloseTo(12 * 0.05, 9);
  });

  it('does not tunnel a thin wall at max speed with dt 0.05', () => {
    const car = driven(17.9, 0, MAX, 0, 0.05);
    const res = resolveWorld(car, townOf([THIN_WALL]), 0.05);
    expect(car.x).toBeCloseTo(20 - R, 9);
    expect(car.vx).toBeCloseTo(0, 9);
    expect(res.impact).toBeCloseTo(MAX, 9);
  });

  it('does not tunnel a thin wall through a 0.2 s hitch (substepping)', () => {
    // One 0.2 s step at max speed is 5.8 m: longer than the 0.3 m wall plus the radius,
    // so the position stepCar left behind is already on the far side of the wall.
    const car = driven(17.9, 0, MAX, 0, 0.2);
    expect(car.x).toBeGreaterThan(20.3 + R);
    resolveWorld(car, townOf([THIN_WALL]), 0.2);
    expect(car.x).toBeCloseTo(20 - R, 9);
    expect(car.vx).toBeCloseTo(0, 9);
  });

  it('keeps the car inside the world bounds', () => {
    const car = driven(BOUNDS.maxX - R - 0.1, BOUNDS.minZ + R, 25, -25, 0.2);
    expect(car.x).toBeGreaterThan(BOUNDS.maxX); // stepCar drove it clean out of the world
    resolveWorld(car, townOf([]), 0.2);
    expect(car.x).toBeCloseTo(BOUNDS.maxX - R, 9);
    expect(car.z).toBeCloseTo(BOUNDS.minZ + R, 9);
  });

  it('never leaves the car inside a box or outside the bounds, sweeping headings and frame times', () => {
    const boxes = [
      BUILDING,
      THIN_WALL,
      { minX: -34, maxX: -33.6, minZ: -34, maxZ: -33.6 }, // tree trunk
      { minX: -8, maxX: 8, minZ: 26, maxZ: 26.4 }, // thin wall across the other axis
    ];
    const town = townOf(boxes);
    const bad = [];
    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * Math.PI * 2;
      for (const dt of [0.016, 0.05, 0.1, 0.2]) {
        const car = mkCar(0, 0, 0, 0);
        for (let s = 0; s < 40; s++) {
          // Throttle held: the sim keeps asking for full speed even against a wall.
          car.vx = Math.cos(a) * MAX;
          car.vz = Math.sin(a) * MAX;
          car.x += car.vx * dt; // stepCar's integration
          car.z += car.vz * dt;
          resolveWorld(car, town, dt);
          const why = { h, dt, s };
          if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) bad.push({ ...why, why: 'NaN position' });
          for (const b of boxes) {
            if (gap(b, car) < R - 1e-6) bad.push({ ...why, why: `inside box ${b.minX},${b.minZ}` });
          }
          if (car.x < BOUNDS.minX + R - 1e-6 || car.x > BOUNDS.maxX - R + 1e-6) bad.push({ ...why, why: 'out of x bounds' });
          if (car.z < BOUNDS.minZ + R - 1e-6 || car.z > BOUNDS.maxZ - R + 1e-6) bad.push({ ...why, why: 'out of z bounds' });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not modify the town', () => {
    const town = townOf([{ minX: 4, maxX: 6, minZ: -2, maxZ: 2 }]);
    const before = JSON.stringify(town);
    resolveWorld(mkCar(3, 0, MAX, 3), town, 0.05);
    resolveWorld(mkCar(5, 0, 0, 0), town, 0.05); // centre-inside path
    expect(JSON.stringify(town)).toBe(before);
  });
});
