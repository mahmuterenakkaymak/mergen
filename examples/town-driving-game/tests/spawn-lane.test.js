import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';

const HALF_ROAD = CONFIG.road / 2;
const onRoad = (town, p) =>
  town.roads.some((c) => Math.abs(p.x - c) <= HALF_ROAD) ||
  town.roads.some((c) => Math.abs(p.z - c) <= HALF_ROAD);

describe('spawn lane', () => {
  it('spawns in the right lane of the centre road, not the left', () => {
    const t = generateTown(CONFIG.seed);
    const centre = t.roads[Math.round(CONFIG.grid / 2)];
    // Heading 0 faces +z (car.js); the right of that direction is -x, so the lane the
    // player starts in must be the one traffic (T33) drives on.
    expect(t.spawn.heading).toBe(0);
    expect(t.spawn.x).toBeLessThan(centre);
    expect(t.spawn.x).toBeGreaterThan(centre - HALF_ROAD);
    expect(onRoad(t, t.spawn)).toBe(true);
  });
});
