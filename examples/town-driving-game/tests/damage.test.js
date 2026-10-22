import { describe, it, expect } from 'vitest';
import { createDamage, applyImpact, repair } from '../src/damage.js';

// The sim's impact event shape (game.js): speed is the velocity a solid removed, m/s.
const hit = (speed) => ({ type: 'impact', speed, contact: { x: 0, z: 0 } });

describe('applyImpact', () => {
  it('costs nothing at or below the 6 m/s threshold', () => {
    const d = createDamage();
    expect(applyImpact(d, hit(0))).toBeNull();
    expect(applyImpact(d, hit(6))).toBeNull();
    expect(d.damage).toBe(0);
    expect(d.smoking).toBe(false);
  });

  it('scales damage with the speed above the threshold', () => {
    const d = createDamage();
    const r = applyImpact(d, hit(20)); // (20 - 6) * 1.6
    expect(r.damage).toBeCloseTo(22.4, 10);
    expect(d.damage).toBeCloseTo(22.4, 10);
  });

  it('accumulates over hits and clamps to 100', () => {
    const d = createDamage();
    applyImpact(d, hit(20));
    applyImpact(d, hit(200));
    expect(d.damage).toBe(100);
  });

  it('reports shake and vignette amounts for the camera and the HUD', () => {
    const d = createDamage();
    const r = applyImpact(d, hit(20));
    expect(r.shake).toBeCloseTo(20 * 0.045, 10);
    expect(r.vignette).toBeCloseTo(22.4 * 0.03, 10);
  });

  it('flags smoking only past 60 damage', () => {
    const light = createDamage();
    expect(applyImpact(light, hit(40)).damage).toBeCloseTo(54.4, 10);
    expect(light.smoking).toBe(false);

    const hot = createDamage();
    applyImpact(hot, hit(44)); // 60.8
    expect(hot.smoking).toBe(true);
  });

  it('warns once when damage crosses 60', () => {
    const d = createDamage();
    expect(applyImpact(d, hit(40)).overheat).toBe(false); // 54.4
    expect(applyImpact(d, hit(10)).overheat).toBe(true); // 60.8, the crossing
    expect(applyImpact(d, hit(10)).overheat).toBe(false); // already warned
    expect(d.damage).toBeCloseTo(67.2, 10);
  });
});

describe('repair', () => {
  it('clears damage, smoke and the overheat warning', () => {
    const d = createDamage();
    applyImpact(d, hit(100));
    repair(d);
    expect(d).toEqual({ damage: 0, smoking: false, warned: false });
  });

  it('lets a later crossing warn again', () => {
    const d = createDamage();
    applyImpact(d, hit(100));
    repair(d);
    expect(applyImpact(d, hit(100)).overheat).toBe(true);
  });
});
