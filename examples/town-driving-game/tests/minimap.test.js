import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';
import { worldToMap, arrowAngle } from '../src/hud/minimap.js';

const town = generateTown(CONFIG.seed);
const SIZE = 200;
const PAD = 10;
const map = worldToMap(town.bounds, SIZE, PAD);

describe('worldToMap', () => {
  it('maps the world corners to the padded panel corners', () => {
    const b = town.bounds;
    const tl = map.toMap(b.minX, b.minZ);
    const br = map.toMap(b.maxX, b.maxZ);
    expect(tl.x).toBeCloseTo(PAD, 6);
    expect(tl.y).toBeCloseTo(PAD, 6); // min z is the top of the panel: north is up
    expect(br.x).toBeCloseTo(SIZE - PAD, 6);
    expect(br.y).toBeCloseTo(SIZE - PAD, 6);
  });

  it('maps the world centre to the panel centre', () => {
    const b = town.bounds;
    const c = map.toMap((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    expect(c.x).toBeCloseTo(SIZE / 2, 6);
    expect(c.y).toBeCloseTo(SIZE / 2, 6);
  });

  it('keeps the whole town inside the panel', () => {
    const b = town.bounds;
    for (const [x, z] of [[b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.minZ], [b.maxX, b.maxZ]]) {
      const m = map.toMap(x, z);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(SIZE);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(SIZE);
    }
  });
});

describe('arrowAngle', () => {
  // The arrow is drawn along local +y; rotating it by the angle must send it along
  // the car's map direction (sin h, cos h) — canvas rotation maps +y to (−sin a, cos a).
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 4, 2.7]) {
    it(`points the arrow along heading ${h.toFixed(2)}`, () => {
      const a = arrowAngle(h);
      expect(-Math.sin(a)).toBeCloseTo(Math.sin(h), 9);
      expect(Math.cos(a)).toBeCloseTo(Math.cos(h), 9);
    });
  }
});
