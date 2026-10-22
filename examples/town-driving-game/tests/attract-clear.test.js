// T83: the attract orbit is the first thing the player sees, and a pose that lands inside a
// building shows the inside of a wall for a few seconds of every lap. Sample the whole lap
// against the town the game actually builds, about the centre main.js really orbits.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateTown } from '../src/town.js';
import { attractPose } from '../src/ui/startScreen.js';

const town = generateTown(CONFIG.seed, CONFIG);
const centre = town.spawn;

// The camera is inside a building when it is over its footprint and under its roof.
const buildingAround = (p) =>
  town.buildings.find((b) =>
    p.x >= b.x && p.x <= b.x + b.w && p.z >= b.z && p.z <= b.z + b.d && p.y < b.height + 1
  ) || null;

describe('attract orbit never enters a building', () => {
  it('clears every footprint over a full lap', () => {
    // One lap is 2π / 0.08 ≈ 78.5 s, so 0..80 covers it; 0.25 s steps are far finer than a
    // building, so a clip cannot slip between two samples.
    const hits = [];
    let samples = 0;
    for (let t = 0; t <= 80; t += 0.25) {
      const p = attractPose(t, centre);
      const b = buildingAround(p);
      if (b) hits.push({ t: +t.toFixed(2), height: +b.height.toFixed(1) });
      samples++;
    }
    expect(samples).toBe(321);
    expect(hits).toEqual([]);
  });
});
