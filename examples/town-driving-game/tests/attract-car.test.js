import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// main.js runs only in a browser (WebGL, DOM, RAF), so the contract we can check
// headlessly is the source itself: which point the attract orbit is built around.
// Circling the bounds midpoint while the car spawns ~29 m away leaves the player a
// few pixels of the car they are about to drive.
const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.js'),
  'utf8'
);

const attractAt = src.match(/const attractAt = ([^;]+);/)?.[1];

describe('attract orbit centres on the car', () => {
  it('derives its centre from the town spawn, not the bounds midpoint', () => {
    expect(attractAt).toBeDefined();
    expect(attractAt).toContain('world.town.spawn');
    expect(attractAt).not.toContain('townCentre(');
  });

  it('uses both spawn axes so the orbit sits over the car', () => {
    expect(attractAt).toContain('world.town.spawn.x');
    expect(attractAt).toContain('world.town.spawn.z');
  });

  it('still feeds that centre to attractPose', () => {
    expect(src).toMatch(/attractPose\(\s*attractT\s*,\s*attractAt\s*\)/);
  });
});
