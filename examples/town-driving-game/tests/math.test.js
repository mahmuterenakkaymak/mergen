import { describe, it, expect } from 'vitest';
import { TAU, clamp, lerp, damp, wrapAngle, angLerp } from '../src/util/math.js';

describe('clamp', () => {
  it('leaves in-range values alone and caps the ends', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('handles negative and asymmetric ranges', () => {
    expect(clamp(-5, -1, 1)).toBe(-1);
    expect(clamp(5, -1, 1)).toBe(1);
    expect(clamp(0.5, -0.25, 0.75)).toBe(0.5);
    expect(clamp(3, 2, 2)).toBe(2);
  });
});

describe('lerp', () => {
  it('hits the ends and the midpoint', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(-4, 4, 0.25)).toBe(-2);
    expect(lerp(-4, 4, 0.5)).toBe(0);
  });

  it('extrapolates outside 0..1 in the right direction', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
    expect(lerp(20, 10, 0.5)).toBe(15);
  });
});

describe('damp', () => {
  it('does nothing with zero dt or zero rate', () => {
    expect(damp(3, 9, 5, 0)).toBe(3);
    expect(damp(3, 9, 0, 0.2)).toBe(3);
  });

  it('uses 1 - exp(-k*dt), so a long frame saturates instead of overshooting', () => {
    expect(damp(2, 8, 3, 0.5)).toBeCloseTo(6.6612, 4);
    expect(damp(0, 10, 10, 1)).toBeGreaterThan(9.999);
    expect(damp(0, 10, 10, 5)).toBeLessThanOrEqual(10);
  });

  it('is frame-rate independent', () => {
    const k = 6.5;
    const h = 1 / 60;
    const two = damp(damp(4, 29, k, h), 29, k, h);
    expect(two).toBeCloseTo(damp(4, 29, k, 2 * h), 12);

    let one = 4;
    let many = 4;
    for (let i = 0; i < 10; i++) many = damp(many, 29, k, h / 10);
    one = damp(one, 29, k, h);
    expect(many).toBeCloseTo(one, 10);
  });

  it('approaches the target monotonically from both sides without crossing it', () => {
    let up = 0;
    let prev = -Infinity;
    for (let i = 0; i < 200; i++) {
      up = damp(up, 10, 4, 1 / 30);
      expect(up).toBeGreaterThan(prev);
      expect(up).toBeLessThan(10);
      prev = up;
    }
    expect(up).toBeCloseTo(10, 6);

    let down = 10;
    for (let i = 0; i < 200; i++) down = damp(down, 0, 4, 1 / 30);
    expect(down).toBeCloseTo(0, 6);
    expect(down).toBeGreaterThan(0);
  });

  it('reaches a higher rate further in the same frame', () => {
    expect(damp(0, 10, 8, 0.1)).toBeGreaterThan(damp(0, 10, 2, 0.1));
  });
});

describe('wrapAngle', () => {
  it('leaves angles already in range untouched', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(3)).toBeCloseTo(3, 12);
  });

  it('folds full turns back to zero', () => {
    expect(wrapAngle(TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(-TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(3 * TAU)).toBeCloseTo(0, 9);
  });

  it('wraps past the ends into the opposite sign', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(-2.5 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(10)).toBeCloseTo(10 - 2 * TAU, 12);
    expect(wrapAngle(-10)).toBeCloseTo(-10 + 2 * TAU, 12);
  });

  it('stays in [-PI, PI) and is idempotent', () => {
    for (let a = -40; a <= 40; a += 0.013) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI - 1e-12);
      expect(w).toBeLessThan(Math.PI + 1e-12);
      expect(wrapAngle(w)).toBeCloseTo(w, 12);
    }
  });
});

describe('angLerp', () => {
  it('interpolates the plain way when the arc is short', () => {
    expect(angLerp(0, Math.PI / 2, 0)).toBeCloseTo(0, 12);
    expect(angLerp(0, Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(angLerp(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 12);
    expect(angLerp(-0.2, 0.3, 0.5)).toBeCloseTo(0.05, 12);
  });

  it('takes the short way across the seam instead of through zero', () => {
    const a = 2.9, b = -2.9;
    const mid = angLerp(a, b, 0.5);
    expect(Math.abs(mid)).toBeGreaterThan(3.0);
    expect(Math.abs(wrapAngle(mid - a))).toBeLessThan(0.3);
    expect(angLerp(a, b, 0.25)).toBeCloseTo(a + wrapAngle(b - a) * 0.25, 12);
    expect(angLerp(a, b, 1)).toBeCloseTo(b, 12);
    expect(angLerp(b, a, 1)).toBeCloseTo(a, 12);
  });

  it('never travels more than half a turn and stays in range', () => {
    for (let a = -Math.PI; a < Math.PI; a += 0.07) {
      for (let b = -Math.PI; b < Math.PI; b += 0.11) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const r = angLerp(a, b, t);
          expect(Math.abs(wrapAngle(r - a))).toBeLessThanOrEqual(Math.PI + 1e-9);
          expect(r).toBeGreaterThanOrEqual(-Math.PI - 1e-12);
          expect(r).toBeLessThan(Math.PI + 1e-12);
        }
      }
    }
  });
});
