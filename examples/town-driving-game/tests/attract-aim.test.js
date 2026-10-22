// T78: the attract camera must aim above the parked car. Aiming at it (y 0) lands the hero
// car at dead screen centre, behind the keycap legend and the CLICK TO DRIVE pill.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attractPose } from '../src/ui/startScreen.js';

// Raising the aim only helps if there is a car where the aim lands. buildCarMesh leaves the
// group at the origin and only the playing branch placed it, so behind the overlay the
// orbit circled an empty street. main.js needs a browser, so check its source.
const mainSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.js'),
  'utf8'
);

const CENTER = { x: 12, z: -34 };
const TS = [0, 7, 19.5, 40, 78.25];

const aim = (t) => attractPose(t, CENTER).lookAt;

describe('attract look target', () => {
  it('aims above the car so it drops into the lower third', () => {
    for (const t of TS) {
      expect(aim(t).y).toBeGreaterThanOrEqual(8);
      expect(aim(t).y).toBeLessThanOrEqual(12);
    }
  });

  it('still looks down at the town, never up at the sky', () => {
    for (const t of TS) {
      const p = attractPose(t, CENTER);
      expect(p.lookAt.y).toBeLessThan(p.y);
    }
  });

  it('keeps the aim on the centre in x/z', () => {
    for (const t of TS) {
      expect(aim(t).x).toBe(CENTER.x);
      expect(aim(t).z).toBe(CENTER.z);
    }
  });

  it('keeps the circular orbit at a fixed radius and height', () => {
    const radius = (p) => Math.hypot(p.x - CENTER.x, p.z - CENTER.z);
    const p0 = attractPose(0, CENTER);
    expect(radius(p0)).toBeGreaterThan(1);
    for (const t of TS) {
      const p = attractPose(t, CENTER);
      expect(radius(p)).toBeCloseTo(radius(p0), 6);
      expect(p.y).toBeCloseTo(p0.y, 6);
    }
  });

  it('parks the car mesh at the spawn while the overlay is up', () => {
    expect(mainSrc).toMatch(
      /stepAmbient\(world, dt\)[\s\S]{0,300}?updateCarMesh\(carMesh, world\.car, dt\)/
    );
  });
});
