import { describe, expect, it } from 'vitest';
import { COVER_POINTS, MAP_DATA } from '../src/core/mapData.js';

function nearestCrate(cover) {
  return MAP_DATA.crates.map((crate) => ({
    crate,
    dist: Math.hypot(crate.center.x - cover.pos.x, crate.center.z - cover.pos.z),
  })).sort((a, b) => a.dist - b.dist)[0].crate;
}

describe('cover point facing', () => {
  const cases = COVER_POINTS.map((cover) => [cover.id, cover]);

  it.each(cases)('%s looks over its nearest crate', (_id, cover) => {
    const crate = nearestCrate(cover);
    const forwardX = -Math.sin(cover.facing);
    const forwardZ = -Math.cos(cover.facing);
    const toCrateX = crate.center.x - cover.pos.x;
    const toCrateZ = crate.center.z - cover.pos.z;

    expect(forwardX * toCrateX + forwardZ * toCrateZ).toBeGreaterThan(0);
  });
});
