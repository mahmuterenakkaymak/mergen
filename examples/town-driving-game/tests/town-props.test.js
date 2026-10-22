import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';

const CELL = CONFIG.block + CONFIG.road;
const HALF_ROAD = CONFIG.road / 2;
const SEEDS = [CONFIG.seed, 7, 99, 4242, 31337, 20261021];

const point = (p) => ({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z });
const overlaps = (a, b, pad = 0) =>
  a.minX < b.maxX + pad && b.minX < a.maxX + pad &&
  a.minZ < b.maxZ + pad && b.minZ < a.maxZ + pad;
const roadStrips = (t) => t.roads.flatMap((c) => [
  { minX: c - HALF_ROAD, maxX: c + HALF_ROAD, minZ: -Infinity, maxZ: Infinity },
  { minX: -Infinity, maxX: Infinity, minZ: c - HALF_ROAD, maxZ: c + HALF_ROAD },
]);
const onAsphalt = (t, p) =>
  t.roads.some((c) => Math.abs(p.x - c) <= HALF_ROAD) ||
  t.roads.some((c) => Math.abs(p.z - c) <= HALF_ROAD);
const key = (b) => `${b.minX}|${b.maxX}|${b.minZ}|${b.maxZ}`;
const centre = (b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });

describe('generateTown props', () => {
  it('puts a streetlight at every corner of every intersection', () => {
    const t = generateTown(CONFIG.seed);
    expect(t.lights.length).toBe((CONFIG.grid + 1) ** 2 * 4);
    expect(new Set(t.lights.map((p) => `${p.x}|${p.z}`)).size).toBe(t.lights.length);

    // One light in each half-cell leaving an intersection: the corner it owns.
    const wrong = [];
    for (const cx of t.roads) {
      for (const cz of t.roads) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const n = t.lights.filter((p) =>
              sx * (p.x - cx) > 0 && sx * (p.x - cx) < CELL / 2 &&
              sz * (p.z - cz) > 0 && sz * (p.z - cz) < CELL / 2).length;
            if (n !== 1) wrong.push({ cx, cz, sx, sz, n });
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps every streetlight off the lanes, inside the world and clear of the colliders', () => {
    for (const seed of SEEDS) {
      const t = generateTown(seed);
      const bad = [];
      for (const p of t.lights) {
        if (onAsphalt(t, p)) bad.push({ p, why: 'lane' });
        if (p.x <= t.bounds.minX || p.x >= t.bounds.maxX) bad.push({ p, why: 'x-bounds' });
        if (p.z <= t.bounds.minZ || p.z >= t.bounds.maxZ) bad.push({ p, why: 'z-bounds' });
        if (t.aabbs.some((b) => overlaps(b, point(p), 1))) bad.push({ p, why: 'collider' });
      }
      expect(bad).toEqual([]);
    }
  });

  it('runs dashes along every road side, clear of the crossings', () => {
    for (const seed of [CONFIG.seed, 4242]) {
      const t = generateTown(seed);
      const bad = [];
      for (const d of t.dashes) {
        const onX = t.roads.some((c) => Math.abs(d.x - c) < 1e-9);
        const onZ = t.roads.some((c) => Math.abs(d.z - c) < 1e-9);
        if (onX === onZ) bad.push({ d, why: onX ? 'in-a-crossing' : 'off-centre-line' });
        else if (t.roads.some((c) => Math.abs((onX ? d.z : d.x) - c) <= HALF_ROAD)) bad.push({ d, why: 'crossing' });
        else if (d.rot !== (onX ? 0 : Math.PI / 2)) bad.push({ d, why: 'rot' });
      }
      expect(bad).toEqual([]);

      for (const c of t.roads) {
        for (let s = 0; s < CONFIG.grid; s++) {
          const lo = s * CELL + HALF_ROAD;
          const hi = (s + 1) * CELL - HALF_ROAD;
          expect(t.dashes.filter((d) => Math.abs(d.x - c) < 1e-9 && d.z > lo && d.z < hi).length).toBeGreaterThan(0);
          expect(t.dashes.filter((d) => Math.abs(d.z - c) < 1e-9 && d.x > lo && d.x < hi).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every building and tree trunk a collider and nothing else has one', () => {
    for (const seed of SEEDS) {
      const t = generateTown(seed);
      expect(t.aabbs.length).toBe(t.buildings.length + t.trees.length);
      const have = new Set(t.aabbs.map(key));
      const missing = [];
      for (const b of t.buildings) {
        if (!have.has(key({ minX: b.x, maxX: b.x + b.w, minZ: b.z, maxZ: b.z + b.d }))) missing.push(b);
      }
      for (const p of t.trees) {
        // The trunk box is the only one centred on the tree, square and trunk-sized.
        const boxes = t.aabbs.filter((b) => {
          const c = centre(b);
          const w = b.maxX - b.minX;
          return c.x === p.x && c.z === p.z && w === b.maxZ - b.minZ && w > 0 && w <= 2;
        });
        if (boxes.length !== 1) missing.push(p);
      }
      expect(missing).toEqual([]);
      expect(t.aabbs.filter((b) => roadStrips(t).some((road) => overlaps(b, road)))).toEqual([]);
    }
  });

  it('is identical for the same seed and different for another', () => {
    for (const seed of [CONFIG.seed, 4242]) {
      const b = generateTown(seed);
      const a = generateTown(seed);
      expect(JSON.stringify(b.lights)).toBe(JSON.stringify(a.lights));
      expect(JSON.stringify(b.dashes)).toBe(JSON.stringify(a.dashes));
      expect(JSON.stringify(b.aabbs)).toBe(JSON.stringify(a.aabbs));
    }
    expect(JSON.stringify(generateTown(CONFIG.seed + 1).aabbs)).not.toBe(JSON.stringify(generateTown(CONFIG.seed).aabbs));
  });
});
