import { describe, it, expect } from 'vitest';
import { makeTraffic, stepTraffic } from '../src/traffic.js';
import { generateTown } from '../src/town.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const town = generateTown(CONFIG.seed, CONFIG);
const trafficRng = () => createRng(CONFIG.seed).fork('traffic');
const FAR = { x: 1e6, z: 1e6 }; // player nowhere near, so a car just cruises

// A car on a road: within half a road width of some centre line on either axis.
const onRoad = (p) =>
  town.roads.some((r) => Math.abs(p.x - r) <= CONFIG.road / 2) ||
  town.roads.some((r) => Math.abs(p.z - r) <= CONFIG.road / 2);

// A square loop for the pure stepTraffic tests.
const square = () => [{ x: 0, z: 0 }, { x: 0, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 0 }];
const mkCar = (over) => ({
  x: 0, z: 0, heading: 0, speed: 8.5, cruise: 8.5, wp: 0, waypoints: square(), ...over,
});

describe('makeTraffic', () => {
  it('spawns the configured number of cars', () => {
    expect(makeTraffic(trafficRng(), town)).toHaveLength(CONFIG.traffic.count);
  });

  it('puts every car on a road, in the right lane', () => {
    for (const c of makeTraffic(trafficRng(), town)) {
      expect(onRoad(c)).toBe(true);
      expect(Number.isFinite(c.heading)).toBe(true);
      expect(CONFIG.colors.traffic).toContain(c.color);
    }
  });

  it('aims each car along its loop toward its next corner', () => {
    for (const c of makeTraffic(trafficRng(), town)) {
      const t = c.waypoints[c.wp];
      const bearing = Math.atan2(t.x - c.x, t.z - c.z);
      const diff = Math.abs(((bearing - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      expect(diff).toBeLessThan(0.2); // heading tracks the leg it sits on
    }
  });

  it('is deterministic for a seed and differs for another', () => {
    const a = makeTraffic(trafficRng(), town);
    const b = makeTraffic(trafficRng(), town);
    expect(a).toEqual(b);
    const other = makeTraffic(createRng(CONFIG.seed + 1).fork('traffic'), town);
    expect(other.map((c) => c.x)).not.toEqual(a.map((c) => c.x));
  });
});

describe('stepTraffic', () => {
  it('follows waypoints: drives to a corner and advances to the next', () => {
    const c = mkCar({ x: 0, z: -10, heading: 0, wp: 0 });
    for (let i = 0; i < 120; i++) stepTraffic([c], FAR, 1 / 60);
    expect(c.wp).toBe(1); // passed corner (0,0), now aiming at (0,20)
    expect(c.z).toBeGreaterThan(0);
    expect(Math.abs(c.x)).toBeLessThan(0.5); // held the lane while going straight
  });

  it('turns smoothly toward the corner bearing (angLerp, not a snap)', () => {
    const c = mkCar({ x: 0, z: 0, heading: 0, wp: 2 }); // next corner (20,20): bearing π/4
    stepTraffic([c], FAR, 1 / 60);
    expect(c.heading).toBeGreaterThan(0);
    expect(c.heading).toBeLessThan(Math.PI / 4);
  });

  it('stops when the player is close and dead ahead', () => {
    const c = mkCar({ x: 0, z: 0, heading: 0, wp: 1 }); // heading +z, corner far at (0,20)
    const player = { x: 0, z: 8 };
    for (let i = 0; i < 90; i++) stepTraffic([c], player, 1 / 60);
    expect(c.speed).toBeLessThan(0.5);
  });

  it('resumes to cruise once the player is gone', () => {
    const c = mkCar({ x: 0, z: 0, heading: 0, wp: 1, speed: 0 });
    for (let i = 0; i < 240; i++) stepTraffic([c], FAR, 1 / 60);
    expect(c.speed).toBeGreaterThan(c.cruise - 0.2);
  });

  it('ignores a player who is behind, beside, or out of range', () => {
    const cases = [
      { x: 0, z: -8 }, // behind
      { x: 8, z: 0 }, // beside (90° off the heading)
      { x: 0, z: 20 }, // ahead but past 11 m
    ];
    for (const player of cases) {
      const c = mkCar({ x: 0, z: 0, heading: 0, wp: 1 });
      for (let i = 0; i < 30; i++) stepTraffic([c], player, 1 / 60);
      expect(c.speed).toBeGreaterThan(c.cruise - 0.5);
    }
  });
});
