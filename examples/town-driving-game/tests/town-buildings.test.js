import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';

const HALF_ROAD = CONFIG.road / 2;
const WORLD = CONFIG.grid * (CONFIG.block + CONFIG.road);
const SEEDS = [CONFIG.seed, 7, 99, 4242, 31337, 20261021];

// Footprints as AABBs: buildings carry w/d, blocks carry w/h.
const box = (r) => ('d' in r
  ? { minX: r.x, maxX: r.x + r.w, minZ: r.z, maxZ: r.z + r.d }
  : { minX: r.x, maxX: r.x + r.w, minZ: r.z, maxZ: r.z + r.h });
const point = (p) => ({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z });
const overlaps = (a, b, pad = 0) =>
  a.minX < b.maxX + pad && b.minX < a.maxX + pad &&
  a.minZ < b.maxZ + pad && b.minZ < a.maxZ + pad;
const roadStrips = (t) => t.roads.flatMap((c) => [
  { minX: c - HALF_ROAD, maxX: c + HALF_ROAD, minZ: -Infinity, maxZ: Infinity },
  { minX: -Infinity, maxX: Infinity, minZ: c - HALF_ROAD, maxZ: c + HALF_ROAD },
]);
const centreDist = (b) => Math.hypot(b.x + b.w / 2 - WORLD / 2, b.z + b.d / 2 - WORLD / 2);
const bandOf = (d) => (d < WORLD * 0.22 ? [18, 42] : d < WORLD * 0.4 ? [9, 26] : [6, 15]);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const inBlock = (b, p) => p.x > b.x && p.x < b.x + b.w && p.z > b.z && p.z < b.z + b.h;
const treesOf = (t, b) => t.trees.filter((p) => inBlock(b, p));
const lotCentres = (t) => t.blocks.filter((b) => !b.park).flatMap((b) => {
  const lot = b.w / 2;
  return [0, 1].flatMap((li) => [0, 1].map((lj) => ({
    x: b.x + li * lot + lot / 2,
    z: b.z + lj * lot + lot / 2,
  })));
});

describe('generateTown buildings', () => {
  it('places every building inside a block, clear of the roads and of each other', () => {
    for (const seed of SEEDS) {
      const t = generateTown(seed);
      expect(t.buildings.length).toBeGreaterThan(20);
      const inside = [];
      const onRoad = [];
      for (const b of t.buildings) {
        const q = box(b);
        if (!t.blocks.some((blk) => {
          const r = box(blk);
          return q.minX >= r.minX && q.maxX <= r.maxX && q.minZ >= r.minZ && q.maxZ <= r.maxZ;
        })) inside.push(b);
        // Lot margins keep the walls off the kerb, not merely off the asphalt.
        if (roadStrips(t).some((road) => overlaps(q, road, 2))) onRoad.push(b);
      }
      expect(inside).toEqual([]);
      expect(onRoad).toEqual([]);

      const pairs = [];
      for (let i = 0; i < t.buildings.length; i++) {
        for (let j = i + 1; j < t.buildings.length; j++) {
          if (overlaps(box(t.buildings[i]), box(t.buildings[j]))) pairs.push([i, j]);
        }
      }
      expect(pairs).toEqual([]);
    }
  });

  it('bands height by distance to the centre: downtown 18-42, mid 9-26, edge 6-15', () => {
    const seen = new Set();
    for (const seed of SEEDS) {
      for (const b of generateTown(seed).buildings) {
        const [lo, hi] = bandOf(centreDist(b));
        seen.add(`${lo}-${hi}`);
        expect(b.height).toBeGreaterThanOrEqual(lo);
        expect(b.height).toBeLessThanOrEqual(hi);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('makes downtown taller on average than midtown and the edge', () => {
    for (const seed of SEEDS) {
      const bs = generateTown(seed).buildings;
      const ring = (lo, hi) => bs.filter((b) => centreDist(b) >= lo && centreDist(b) < hi);
      const downtown = ring(0, WORLD * 0.22);
      const mid = ring(WORLD * 0.22, WORLD * 0.4);
      const edge = ring(WORLD * 0.4, Infinity);
      const h = (list) => mean(list.map((b) => b.height));
      expect(downtown.length).toBeGreaterThan(0);
      expect(mid.length).toBeGreaterThan(0);
      expect(edge.length).toBeGreaterThan(0);
      expect(h(downtown)).toBeGreaterThan(h(mid));
      expect(h(mid)).toBeGreaterThan(h(edge));
    }
  });

  it('gives each building a facade index inside the palette', () => {
    for (const seed of SEEDS) {
      const idx = generateTown(seed).buildings.map((b) => b.facade);
      for (const f of idx) {
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(CONFIG.palette.length);
      }
      expect(new Set(idx).size).toBeGreaterThan(1);
    }
  });

  it('keeps trees off the roads, out of buildings and out of the water', () => {
    for (const seed of SEEDS) {
      const t = generateTown(seed);
      expect(t.trees.length).toBeGreaterThan(0);
      const bad = [];
      for (const p of t.trees) {
        if (!t.blocks.some((b) => inBlock(b, p))) bad.push({ p, why: 'off-block' });
        if (roadStrips(t).some((road) => overlaps(point(p), road))) bad.push({ p, why: 'road' });
        if (t.buildings.some((b) => overlaps(point(p), box(b), 1))) bad.push({ p, why: 'building' });
      }
      expect(bad).toEqual([]);

      for (const pond of t.ponds) {
        expect(t.blocks.some((b) => b.park && inBlock(b, pond))).toBe(true);
        expect(pond.r).toBeGreaterThanOrEqual(4);
        expect(pond.r).toBeLessThan(7);
        for (const p of t.trees) {
          expect(Math.hypot(p.x - pond.x, p.z - pond.z)).toBeGreaterThan(pond.r);
        }
      }
    }
  });

  it('greens every park and gives about half of them a pond', () => {
    let parks = 0;
    let ponds = 0;
    let trees = 0;
    for (let s = 0; s < 40; s++) {
      const t = generateTown(1000 + s);
      for (const b of t.blocks) {
        if (!b.park) continue;
        parks++;
        trees += treesOf(t, b).length;
        expect(treesOf(t, b).length).toBeGreaterThan(0);
      }
      ponds += t.ponds.length;
    }
    expect(parks).toBeGreaterThan(0);
    expect(trees / parks).toBeGreaterThanOrEqual(4);
    expect(ponds / parks).toBeGreaterThan(0.3);
    expect(ponds / parks).toBeLessThan(0.7);
  });

  it('turns empty lots into trees, never into a tree and a building', () => {
    let onLot = 0;
    for (const seed of SEEDS) {
      const t = generateTown(seed);
      const centres = lotCentres(t);
      for (const p of t.trees) {
        if (!centres.some((c) => Math.abs(c.x - p.x) < 1e-9 && Math.abs(c.z - p.z) < 1e-9)) continue;
        onLot++;
        expect(t.buildings.some((b) => b.x < p.x && p.x < b.x + b.w && b.z < p.z && p.z < b.z + b.d)).toBe(false);
      }
    }
    expect(onLot).toBeGreaterThan(0);
  });

  it('is identical for the same seed and different for another', () => {
    for (const seed of [CONFIG.seed, 4242]) {
      expect(JSON.stringify(generateTown(seed))).toBe(JSON.stringify(generateTown(seed)));
    }
    const a = generateTown(CONFIG.seed);
    const b = generateTown(CONFIG.seed + 1);
    expect(b.buildings.map((x) => x.height)).not.toEqual(a.buildings.map((x) => x.height));
    expect(JSON.stringify(b.trees)).not.toBe(JSON.stringify(a.trees));
    expect(JSON.stringify(b.ponds)).not.toBe(JSON.stringify(a.ponds));
  });
});
