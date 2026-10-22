import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';

describe('config', () => {
  it('town constants match the prototype', () => {
    expect(CONFIG.seed).toBe(20261020);
    expect(CONFIG.grid).toBe(6);
    expect(CONFIG.block).toBe(54);
    expect(CONFIG.road).toBe(14);
    expect(CONFIG.wall).toBe(3);
  });

  it('car has every prototype tunable with prototype values', () => {
    expect(CONFIG.car).toMatchObject({
      accel: 10.5, brake: 24, reverseMax: 9, maxSpeed: 29,
      drag: 0.45, rollResist: 1.2,
      steerMax: 0.62, steerSpeed: 2.6, refSpeed: 9,
      grip: 6.5, handGrip: 1.6, handDrag: 2.2,
      radius: 2.05,
    });
    expect(Object.keys(CONFIG.car)).toHaveLength(13);
    for (const v of Object.values(CONFIG.car)) expect(v).toBeGreaterThan(0);
  });

  it('camera tunables with sane ranges', () => {
    expect(CONFIG.cam).toMatchObject({
      dist: 10.5, minDist: 5.5, maxDist: 20,
      pitch0: 0.42, height: 1.7, fov: 62, fovMax: 73,
    });
    expect(CONFIG.cam.minDist).toBeLessThan(CONFIG.cam.dist);
    expect(CONFIG.cam.dist).toBeLessThan(CONFIG.cam.maxDist);
    expect(CONFIG.cam.pitch0).toBeGreaterThan(CONFIG.cam.pitchMin);
    expect(CONFIG.cam.pitch0).toBeLessThan(CONFIG.cam.pitchMax);
    expect(CONFIG.cam.fov).toBeLessThan(CONFIG.cam.fovMax);
  });

  it('reverse is slower than forward, handbrake grip is lower', () => {
    expect(CONFIG.car.reverseMax).toBeLessThan(CONFIG.car.maxSpeed);
    expect(CONFIG.car.handGrip).toBeLessThan(CONFIG.car.grip);
  });

  it('traffic, peds, fx pools, audio volumes', () => {
    expect(CONFIG.traffic.count).toBe(14);
    expect(CONFIG.traffic.speed).toBeGreaterThan(0);
    expect(CONFIG.peds.count).toBe(26);
    expect(CONFIG.fx.skids).toBe(500);
    expect(CONFIG.fx.particles).toBe(420);
    for (const v of Object.values(CONFIG.audio)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('palette and colors', () => {
    expect(CONFIG.palette).toHaveLength(10);
    for (const c of CONFIG.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(CONFIG.colors.carBody).toBe(0xd62828);
    expect(CONFIG.colors.traffic).toHaveLength(8);
    expect(CONFIG.colors.peds).toHaveLength(8);
    for (const c of [...CONFIG.colors.traffic, ...CONFIG.colors.peds]) {
      expect(Number.isInteger(c)).toBe(true);
    }
    for (const v of Object.values(CONFIG.colors)) {
      const items = Array.isArray(v) ? v : [v];
      for (const c of items) {
        if (typeof c === 'string') expect(c).toMatch(/^#[0-9a-f]{6}$/);
        else expect(Number.isInteger(c)).toBe(true);
      }
    }
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONFIG.car)).toBe(true);
    expect(Object.isFrozen(CONFIG.cam)).toBe(true);
    expect(Object.isFrozen(CONFIG.palette)).toBe(true);
    expect(Object.isFrozen(CONFIG.colors.traffic)).toBe(true);
    expect(() => { CONFIG.seed = 1; }).toThrow();
    expect(() => { CONFIG.car.accel = 99; }).toThrow();
    expect(() => { CONFIG.palette.push('#000000'); }).toThrow();
    expect(CONFIG.seed).toBe(20261020);
    expect(CONFIG.car.accel).toBe(10.5);
  });
});
