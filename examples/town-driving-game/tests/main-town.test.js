import { describe, it, expect } from 'vitest';
import { townCentre } from '../src/main.js';
import { attractPose } from '../src/ui/startScreen.js';
import { generateTown } from '../src/town.js';

// The start screen flies the camera over the town main.js renders. Both halves run in
// Node (the pose is pure, the town is pure), so the one thing wiring can get wrong —
// orbiting the origin instead of the town — fails here.
const town = generateTown();

describe('attract orbit over the town', () => {
  it('takes the town middle from the bounds, not the origin', () => {
    const c = townCentre(town);
    const b = town.bounds;
    expect(c.x).toBeCloseTo((b.minX + b.maxX) / 2, 6);
    expect(c.z).toBeCloseTo((b.minZ + b.maxZ) / 2, 6);
    // the grid starts at the origin, so {0, 0} is a corner of the map
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(50);
  });

  it('circles that middle at a fixed radius and height, looking at it', () => {
    const c = townCentre(town);
    let radius;
    for (const t of [0, 7, 60, 400, 1200]) {
      const p = attractPose(t, c);
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (radius === undefined) radius = d;
      expect(d).toBeCloseTo(radius, 6);
      // ASSUMPTION: the aim is the raised one (LOOK_H 12), not the ground; whether the ring
      // clears the towers is sampled over the footprints in attract-clear.test.js.
      expect(p.lookAt).toEqual({ x: c.x, y: 12, z: c.z });
    }
  });

  it('keeps the whole orbit over the town, inside the perimeter walls', () => {
    const c = townCentre(town);
    const b = town.bounds;
    for (let t = 0; t < 4000; t += 3) {
      const p = attractPose(t, c);
      expect(p.x).toBeGreaterThan(b.minX);
      expect(p.x).toBeLessThan(b.maxX);
      expect(p.z).toBeGreaterThan(b.minZ);
      expect(p.z).toBeLessThan(b.maxZ);
    }
  });
});

describe('main.js town wiring', () => {
  it('imports in Node with the town view modules linked in', async () => {
    expect(typeof document).toBe('undefined');
    const m = await import('../src/main.js');
    expect(typeof m.boot).toBe('function');
    expect(typeof m.townCentre).toBe('function');
  });
});
