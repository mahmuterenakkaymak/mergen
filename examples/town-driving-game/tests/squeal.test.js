import { describe, it, expect } from 'vitest';
import { squealLevel } from '../src/audio/engineModel.js';

describe('squealLevel', () => {
  it('stays silent while the tyres still grip', () => {
    expect(squealLevel(3, false)).toBe(0);
    expect(squealLevel(7.9, false)).toBe(0);
    expect(squealLevel(99, false)).toBe(0);
  });

  it('rings the squeal in once the car is skidding', () => {
    expect(squealLevel(6, true)).toBeGreaterThan(0);
    expect(squealLevel(6, true)).toBeCloseTo(0.75);
    expect(squealLevel(8, true)).toBe(1);
  });

  it('caps at full and never goes negative', () => {
    expect(squealLevel(99, true)).toBe(1);
    expect(squealLevel(-4, true)).toBe(0);
  });

  it('grows with the slide', () => {
    expect(squealLevel(6, true)).toBeGreaterThan(squealLevel(2, true));
  });
});
