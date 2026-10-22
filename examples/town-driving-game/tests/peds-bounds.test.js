import { describe, it, expect } from 'vitest';
import { makePeds, stepPeds } from '../src/peds.js';
import { generateTown } from '../src/town.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const town = generateTown(CONFIG.seed, CONFIG);
const pedsRng = () => createRng(CONFIG.seed).fork('peds');

// A walker at the end of its block, with a fast car half a metre behind it, is shoved the
// full clip distance (car.radius + PED_R = 2.5 m) — past the block end, into the road or
// the crossing there. The block ends bound it as hard as the sidewalk band does.
const walkerOn = (axis) => makePeds(pedsRng(), town).find((p) => p.axis === axis);

describe('stepPeds block-end bounds', () => {
  it('keeps an x-axis walker inside its block when shoved at the far end', () => {
    const p = walkerOn('x');
    expect(p).toBeDefined();
    p.x = p.hi;
    p.dir = 1;
    stepPeds([p], { x: p.hi - 0.5, z: p.cross, speed: 10 }, 1 / 60);
    expect(p.x).toBeGreaterThanOrEqual(p.lo);
    expect(p.x).toBeLessThanOrEqual(p.hi);
  });

  it('keeps a z-axis walker inside its block when shoved at the far end', () => {
    const p = walkerOn('z');
    expect(p).toBeDefined();
    p.z = p.hi;
    p.dir = 1;
    stepPeds([p], { x: p.cross, z: p.hi - 0.5, speed: 10 }, 1 / 60);
    expect(p.z).toBeGreaterThanOrEqual(p.lo);
    expect(p.z).toBeLessThanOrEqual(p.hi);
  });
});
