import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { clamp } from '../src/util/math.js';
import { resolveCircleAabb } from '../src/collision.js';

const BOX = { minX: 0, maxX: 10, minZ: -4, maxZ: 4 };
const R = 2;

const v = (x, z) => ({ x, z });
const len = (a) => Math.hypot(a.x, a.z);
const closestOn = (b, p) => v(clamp(p.x, b.minX, b.maxX), clamp(p.z, b.minZ, b.maxZ));
// Distance from the centre to the box; 0 while the centre is inside it.
const gap = (b, p) => { const c = closestOn(b, p); return len(v(p.x - c.x, p.z - c.z)); };

describe('resolveCircleAabb', () => {
  it('leaves a circle that misses the box alone and reports no contact', () => {
    const p = v(20, 0);
    const vel = v(-5, 3);
    expect(resolveCircleAabb(p, vel, R, BOX)).toBeNull();
    expect(p).toEqual({ x: 20, z: 0 });
    expect(vel).toEqual({ x: -5, z: 3 });

    // Corner near-miss: 1.5 m off each face of (10, 4) is 2.12 m away, just outside r.
    const q = v(11.5, 5.5);
    expect(resolveCircleAabb(q, v(-5, -5), R, BOX)).toBeNull();
    expect(q).toEqual({ x: 11.5, z: 5.5 });
  });

  it('pushes a face hit back to exactly r and reports the outward normal', () => {
    const p = v(11.4, 0);
    const res = resolveCircleAabb(p, v(-8, 0), R, BOX);
    expect(p.x).toBeCloseTo(12, 9);
    expect(p.z).toBeCloseTo(0, 9);
    expect(res.normal).toEqual({ x: 1, z: 0 });
    expect(res.impact).toBeCloseTo(8, 9);
    expect(res.contact.x).toBeCloseTo(10, 9);
    expect(res.contact.z).toBeCloseTo(0, 9);

    // The opposite face pushes the other way.
    const back = v(-1.4, 1);
    const res2 = resolveCircleAabb(back, v(6, 0), R, BOX);
    expect(res2.normal).toEqual({ x: -1, z: 0 });
    expect(back.x).toBeCloseTo(-2, 9);
    expect(res2.contact.x).toBeCloseTo(0, 9);
  });

  it('removes only the into-wall velocity so the car slides along the face', () => {
    const p = v(11.4, 0);
    const vel = v(-8, 6);
    const res = resolveCircleAabb(p, vel, R, BOX);
    expect(res.impact).toBeCloseTo(8, 9);
    expect(p.x).toBeCloseTo(12, 9);
    // Tangential speed survives untouched: no friction, no rebound.
    expect(vel).toEqual({ x: 0, z: 6 });
  });

  it('keeps a velocity that already points away from the wall', () => {
    const p = v(11.4, 0);
    const vel = v(4, 0);
    const res = resolveCircleAabb(p, vel, R, BOX);
    expect(p.x).toBeCloseTo(12, 9);
    expect(vel).toEqual({ x: 4, z: 0 });
    expect(res.impact).toBe(0);
  });

  it('pushes a corner hit out along the diagonal', () => {
    const p = v(11, 5); // 1 m past both faces of the (10, 4) corner
    const vel = v(-6, -6);
    const res = resolveCircleAabb(p, vel, R, BOX);
    expect(len(res.normal)).toBeCloseTo(1, 12);
    expect(res.normal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(res.normal.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(len(v(p.x - 10, p.z - 4))).toBeCloseTo(R, 9);
    // -6,-6 points straight along the normal, so all of it goes.
    expect(res.impact).toBeCloseTo(len(v(-6, -6)), 9);
    expect(vel.x).toBeCloseTo(0, 9);
    expect(vel.z).toBeCloseTo(0, 9);
  });

  it('escapes a centre-inside circle through the nearest face', () => {
    // 0.5 m from the +X face, 3 m from the +Z face.
    const p = v(9.5, -1);
    const res = resolveCircleAabb(p, v(0, 0), R, BOX);
    expect(res.normal).toEqual({ x: 1, z: 0 });
    expect(p.x).toBeCloseTo(12, 9);
    expect(p.z).toBeCloseTo(-1, 9);
    expect(res.impact).toBe(0);

    // Same box, now nearer the top face.
    const q = v(5, 3.4);
    const res2 = resolveCircleAabb(q, v(0, 0), R, BOX);
    expect(res2.normal).toEqual({ x: 0, z: 1 });
    expect(q.z).toBeCloseTo(6, 9);
    expect(q.x).toBeCloseTo(5, 9);
  });

  it('reports a zero-impact contact for a circle resting on the face', () => {
    const p = v(12, 0);
    const vel = v(0, 6);
    const res = resolveCircleAabb(p, vel, R, BOX);
    expect(res.impact).toBe(0);
    expect(p.x).toBeCloseTo(12, 12);
    expect(vel).toEqual({ x: 0, z: 6 });

    // Resting on the face but still driving into it: the push-out is nil, the speed is not.
    const res2 = resolveCircleAabb(p, v(-8, 6), R, BOX);
    expect(res2.impact).toBeCloseTo(8, 9);
    expect(p.x).toBeCloseTo(12, 12);
  });

  it('stops a car-sized circle at a building face at full speed', () => {
    const r = CONFIG.car.radius;
    const p = v(11, 0);
    const vel = v(-CONFIG.car.maxSpeed, 0);
    const res = resolveCircleAabb(p, vel, r, BOX);
    expect(p.x).toBeCloseTo(10 + r, 9);
    expect(vel.x).toBeCloseTo(0, 9);
    expect(res.impact).toBeCloseTo(CONFIG.car.maxSpeed, 9);
  });

  it('never leaves the circle overlapping, with a unit normal and a contact on the face', () => {
    const boxes = [
      BOX,
      { minX: -1, maxX: 1, minZ: -30, maxZ: 30 }, // perimeter-wall sliver
      { minX: 0, maxX: 0.4, minZ: 0, maxZ: 0.4 }, // tree trunk
    ];
    const bad = [];
    for (const b of boxes) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const ring = len(v((b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)) + 4;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const out = v(cx + Math.cos(a) * ring, cz + Math.sin(a) * ring);
        const c0 = closestOn(b, out);
        const d = len(v(out.x - c0.x, out.z - c0.z));
        const ux = (out.x - c0.x) / d;
        const uz = (out.z - c0.z) / d;
        // Park the centre half a radius inside the surface, driving in at 10 m/s.
        const p = v(c0.x + ux * R * 0.5, c0.z + uz * R * 0.5);
        const vel = v(-ux * 10, -uz * 10);
        const res = resolveCircleAabb(p, vel, R, b);
        const why = { box: b, a: a.toFixed(3) };
        if (!res) bad.push({ ...why, why: 'no contact' });
        else {
          if (Math.abs(len(res.normal) - 1) > 1e-9) bad.push({ ...why, why: 'normal not unit' });
          if (gap(b, p) < R - 1e-9) bad.push({ ...why, why: 'still overlapping' });
          if (res.contact.x < b.minX - 1e-9 || res.contact.x > b.maxX + 1e-9) bad.push({ ...why, why: 'contact off x' });
          if (res.contact.z < b.minZ - 1e-9 || res.contact.z > b.maxZ + 1e-9) bad.push({ ...why, why: 'contact off z' });
          if (res.impact < 0) bad.push({ ...why, why: 'negative impact' });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not modify the box', () => {
    const b = { minX: 0, maxX: 10, minZ: -4, maxZ: 4 };
    resolveCircleAabb(v(9, 0), v(-9, 0), R, b);
    resolveCircleAabb(v(5, 0), v(0, 0), R, b); // centre-inside path
    expect(b).toEqual({ minX: 0, maxX: 10, minZ: -4, maxZ: 4 });
  });
});
