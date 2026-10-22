import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { toKmh, gearLetter, damagePct, tweenNumber } from '../src/hud/format.js';

const DT = 1 / 60;

function tweenFrames(from, to, n, dt = DT) {
  let v = from;
  for (let i = 0; i < n; i++) v = tweenNumber(v, to, dt);
  return v;
}

describe('toKmh', () => {
  it('converts m/s to km/h as a whole number', () => {
    expect(toKmh(0)).toBe(0);
    expect(toKmh(10)).toBe(36);
    expect(Number.isInteger(toKmh(12.345))).toBe(true);
  });

  it('ignores the sign — the gear letter carries the direction', () => {
    expect(toKmh(-10)).toBe(toKmh(10));
  });

  it('reads top speed as a plausible road number', () => {
    expect(toKmh(CONFIG.car.maxSpeed)).toBe(104);
  });
});

describe('gearLetter', () => {
  it('shows D while rolling forward or parked with a free brake', () => {
    expect(gearLetter(12, 0)).toBe('D');
    expect(gearLetter(0, 0)).toBe('D');
  });

  it('shows R once the car travels backwards', () => {
    expect(gearLetter(-0.7, 0)).toBe('R');
    expect(gearLetter(-8, 0)).toBe('R');
  });

  it('shows R while the brake holds the car still or creeping', () => {
    expect(gearLetter(0, 1)).toBe('R');
    expect(gearLetter(0.4, 1)).toBe('R');
    expect(gearLetter(0.4, 0)).toBe('D');
  });
});

describe('damagePct', () => {
  it('rounds the sim damage to a whole percent', () => {
    expect(damagePct(0)).toBe(0);
    expect(damagePct(42.6)).toBe(43);
  });

  it('stays inside the bar', () => {
    expect(damagePct(-5)).toBe(0);
    expect(damagePct(120)).toBe(100);
  });
});

describe('tweenNumber', () => {
  it('eases toward the target instead of jumping', () => {
    const v = tweenNumber(0, 100, DT);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(50);
  });

  it('settles exactly on the target so the readout stops moving', () => {
    expect(tweenFrames(0, 60, 120)).toBe(60);
    expect(tweenFrames(60, 0, 120)).toBe(0);
    expect(tweenNumber(50, 50.2, DT)).toBe(50.2);
  });

  it('never overshoots, from below or above', () => {
    for (const [from, to] of [[0, 80], [80, 0]]) {
      let v = from;
      for (let i = 0; i < 200; i++) {
        const next = tweenNumber(v, to, DT);
        expect(Math.abs(next - to)).toBeLessThanOrEqual(Math.abs(v - to));
        v = next;
      }
    }
  });

  it('is frame-rate independent', () => {
    expect(tweenFrames(0, 100, 10, DT)).toBeCloseTo(tweenFrames(0, 100, 24, 1 / 144), 6);
  });
});
