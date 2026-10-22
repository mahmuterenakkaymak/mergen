import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';

const CELL = CONFIG.block + CONFIG.road;
const HALF_ROAD = CONFIG.road / 2;

const parksOf = (town) => town.blocks.filter((b) => b.park).length;
const onRoad = (town, p) =>
  town.roads.some((c) => Math.abs(p.x - c) <= HALF_ROAD) ||
  town.roads.some((c) => Math.abs(p.z - c) <= HALF_ROAD);
const onBlock = (town, p) =>
  town.blocks.some((b) => p.x > b.x && p.x < b.x + b.w && p.z > b.z && p.z < b.z + b.h);

describe('generateTown layout', () => {
  it('draws grid+1 road centre lines per axis and one block per cell', () => {
    const t = generateTown(CONFIG.seed);
    expect(t.roads).toHaveLength(CONFIG.grid + 1);
    expect(t.roads[0]).toBe(0);
    expect(t.roads[CONFIG.grid]).toBe(CONFIG.grid * CELL);
    expect(t.blocks).toHaveLength(CONFIG.grid ** 2);
    for (const b of t.blocks) {
      expect(b.w).toBe(CONFIG.block);
      expect(b.h).toBe(CONFIG.block);
    }
  });

  it('keeps every block clear of the roads and inside the world bounds', () => {
    const t = generateTown(CONFIG.seed);
    for (const b of t.blocks) {
      // Blocks start at the edge of the road and stop where the next road's asphalt begins.
      expect(t.roads.some((c) => Math.abs(b.x - HALF_ROAD - c) < 1e-9)).toBe(true);
      expect(t.roads.some((c) => Math.abs(b.x + b.w + HALF_ROAD - c) < 1e-9)).toBe(true);
      expect(b.x).toBeGreaterThan(t.bounds.minX);
      expect(b.x + b.w).toBeLessThan(t.bounds.maxX);
      expect(b.z).toBeGreaterThan(t.bounds.minZ);
      expect(b.z + b.h).toBeLessThan(t.bounds.maxZ);
    }
  });

  it('bounds the world half a road plus a metre beyond the outer centre lines', () => {
    const { bounds } = generateTown(CONFIG.seed);
    const outer = CONFIG.grid * CELL;
    expect(bounds).toEqual({
      minX: -HALF_ROAD - 1,
      maxX: outer + HALF_ROAD + 1,
      minZ: -HALF_ROAD - 1,
      maxZ: outer + HALF_ROAD + 1,
    });
  });

  it('turns about 16% of the blocks into parks', () => {
    let blocks = 0;
    let parks = 0;
    for (let s = 0; s < 40; s++) {
      const t = generateTown(1000 + s);
      blocks += t.blocks.length;
      parks += parksOf(t);
    }
    expect(parks / blocks).toBeGreaterThan(0.08);
    expect(parks / blocks).toBeLessThan(0.26);
  });

  it('spawns the car on a road, off any block and inside the bounds', () => {
    for (const seed of [CONFIG.seed, 7, 99, 20261021]) {
      const t = generateTown(seed);
      const { spawn } = t;
      expect(onRoad(t, spawn)).toBe(true);
      expect(onBlock(t, spawn)).toBe(false);
      expect(spawn.x).toBeGreaterThan(t.bounds.minX);
      expect(spawn.x).toBeLessThan(t.bounds.maxX);
      expect(spawn.z).toBeGreaterThan(t.bounds.minZ);
      expect(spawn.z).toBeLessThan(t.bounds.maxZ);
      expect(Number.isFinite(spawn.heading)).toBe(true);
    }
  });
});

describe('generateTown determinism', () => {
  it('gives the identical town JSON for the same seed', () => {
    expect(JSON.stringify(generateTown(CONFIG.seed))).toBe(JSON.stringify(generateTown(CONFIG.seed)));
    expect(JSON.stringify(generateTown(4242))).toBe(JSON.stringify(generateTown(4242)));
  });

  it('gives a different town for another seed', () => {
    const a = generateTown(CONFIG.seed);
    expect(JSON.stringify(generateTown(CONFIG.seed + 1))).not.toBe(JSON.stringify(a));
    expect(generateTown(31337).blocks.map((b) => b.park)).not.toEqual(a.blocks.map((b) => b.park));
  });
});
