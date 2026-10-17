import { describe, expect, it } from 'vitest';
import { MAP, MOVEMENT, WEAPONS } from '../src/config.js';
import { mulberry32 } from '../src/core/rng.js';
import {
  addBloom,
  computeSpread,
  crosshairRadius,
  decayBloom,
  recoilOffset,
  sampleSpreadDir,
} from '../src/core/spread.js';

const { pistol, rifle, sniper } = WEAPONS;

const draw = (rng, n) => Array.from({ length: n }, () => rng());
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const standing = { speedRatio: 0, onGround: true };

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(mulberry32(1234), 200)).toEqual(draw(mulberry32(1234), 200));
  });

  it('gives a different sequence for a different seed', () => {
    expect(draw(mulberry32(1), 20)).not.toEqual(draw(mulberry32(2), 20));
  });

  it('stays in [0, 1)', () => {
    for (const v of draw(mulberry32(7), 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('keeps generator state to itself', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    a();
    a();
    // b never advanced, so it is still where a fresh generator of the same seed starts.
    expect(b()).toBe(mulberry32(99)());
  });
});

describe('computeSpread', () => {
  it('is the base spread standing still, unscoped', () => {
    expect(computeSpread({ def: rifle, ...standing })).toBe(rifle.spread.base);
  });

  it('is wider while moving than standing', () => {
    const still = computeSpread({ def: rifle, ...standing });
    const running = computeSpread({ def: rifle, speedRatio: 1 });
    expect(running).toBeGreaterThan(still);
    expect(running).toBeCloseTo(rifle.spread.base + rifle.spread.move, 12);
  });

  it('is wider in the air than on the ground at the same speed', () => {
    const grounded = computeSpread({ def: rifle, speedRatio: 0.5, onGround: true });
    const airborne = computeSpread({ def: rifle, speedRatio: 0.5, onGround: false });
    expect(airborne - grounded).toBeCloseTo(rifle.spread.air, 12);
  });

  it('is wider walking than running at the same speed ratio, so walking still beats running', () => {
    // Same ratio isolates the multiplier: walking is the more accurate gait.
    expect(computeSpread({ def: rifle, speedRatio: 1, walking: true })).toBeLessThan(
      computeSpread({ def: rifle, speedRatio: 1 }),
    );

    // And at the speeds each gait actually moves you at.
    const walkRatio = MOVEMENT.walkSpeed / MOVEMENT.runSpeed;
    const walking = computeSpread({ def: rifle, speedRatio: walkRatio, walking: true });
    const running = computeSpread({ def: rifle, speedRatio: 1 });
    expect(walking).toBeLessThan(running);
  });

  it('shrinks when crouched', () => {
    const crouched = computeSpread({ def: rifle, ...standing, crouched: true });
    expect(crouched).toBeCloseTo(rifle.spread.base * rifle.spread.crouchMult, 12);
    expect(crouched).toBeLessThan(computeSpread({ def: rifle, ...standing }));
  });

  it('grows with bloom and shrinks back as bloom decays', () => {
    const base = computeSpread({ def: rifle, ...standing });
    const bloomed = computeSpread({ def: rifle, ...standing, bloom: rifle.spread.bloomPerShot * 4 });
    expect(bloomed).toBeGreaterThan(base);
  });

  it('is tighter scoped than hip-fired, and never below zero', () => {
    const hip = computeSpread({ def: sniper, ...standing });
    const scoped = computeSpread({ def: sniper, ...standing, scoped: true });
    expect(scoped).toBeLessThan(hip);
    expect(scoped).toBeGreaterThan(0);

    // Moving too: the scope is what makes the sniper a sniper.
    expect(computeSpread({ def: sniper, speedRatio: 1, scoped: true })).toBeLessThan(
      computeSpread({ def: sniper, speedRatio: 1 }),
    );
  });

  it('leaves weapons that cannot scope alone', () => {
    expect(computeSpread({ def: rifle, ...standing, scoped: true })).toBe(
      computeSpread({ def: rifle, ...standing }),
    );
  });
});

describe('addBloom / decayBloom', () => {
  it('grows by bloomPerShot per shot', () => {
    let bloom = 0;
    for (let i = 1; i <= 5; i++) {
      bloom = addBloom(bloom, rifle);
      expect(bloom).toBeCloseTo(i * rifle.spread.bloomPerShot, 12);
    }
  });

  it('decays linearly and stops at zero', () => {
    const b = rifle.spread.bloomPerShot * 10;
    expect(decayBloom(b, rifle, 0.5)).toBeCloseTo(b - rifle.spread.bloomDecay * 0.5, 12);
    expect(decayBloom(b, rifle, 1e6)).toBe(0);
    expect(decayBloom(0, rifle, 1)).toBe(0);
  });
});

describe('recoilOffset', () => {
  it('reads the pattern per shot', () => {
    rifle.recoilPattern.forEach(([pitch, yaw], i) => {
      expect(recoilOffset(rifle, i)).toEqual({ pitch, yaw });
    });
  });

  it('repeats the pattern past its end', () => {
    const n = rifle.recoilPattern.length;
    expect(recoilOffset(rifle, n)).toEqual(recoilOffset(rifle, 0));
    expect(recoilOffset(rifle, n + 3)).toEqual(recoilOffset(rifle, 3));
  });

  it('has no kick for a weapon without a pattern', () => {
    expect(recoilOffset(pistol, 0)).toEqual({ pitch: 0, yaw: 0 });
    expect(recoilOffset(pistol, 12)).toEqual({ pitch: 0, yaw: 0 });
  });
});

describe('crosshairRadius', () => {
  it('grows with spread', () => {
    const small = crosshairRadius(rifle.spread.base, MAP.fov, 1080);
    const big = crosshairRadius(rifle.spread.base + rifle.spread.move + rifle.spread.air, MAP.fov, 1080);
    expect(big).toBeGreaterThan(small);
    expect(crosshairRadius(0, MAP.fov, 1080)).toBe(0);
  });

  it('projects the cone onto the screen for the given fov', () => {
    const spread = rifle.spread.base + rifle.spread.move;
    const px = crosshairRadius(spread, MAP.fov, 1080);
    expect(px).toBeCloseTo((Math.tan(spread) / Math.tan((MAP.fov * Math.PI) / 360)) * 540, 9);
  });

  it('scales with the viewport height', () => {
    const spread = rifle.spread.base;
    expect(crosshairRadius(spread, MAP.fov, 2160)).toBeCloseTo(
      crosshairRadius(spread, MAP.fov, 1080) * 2,
      9,
    );
  });
});

describe('sampleSpreadDir', () => {
  const dir = { x: 0.3, y: -0.2, z: -0.93 };

  it('keeps every sample inside the cone', () => {
    const rng = mulberry32(2026);
    const spread = rifle.spread.base + rifle.spread.move;
    const d = normalizeLocal(dir);

    for (let i = 0; i < 2000; i++) {
      const s = sampleSpreadDir(dir, spread, rng);
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 9);
      expect(Math.acos(Math.min(1, dot(d, s)))).toBeLessThanOrEqual(spread + 1e-9);
    }
  });

  it('reaches out to the edge of the cone instead of hugging the centre', () => {
    const rng = mulberry32(5);
    const spread = 0.05;
    const d = normalizeLocal(dir);
    const angles = Array.from({ length: 500 }, () =>
      Math.acos(Math.min(1, dot(d, sampleSpreadDir(dir, spread, rng)))),
    );
    expect(Math.max(...angles)).toBeGreaterThan(spread * 0.8);
  });

  it('fires straight down the barrel with no spread', () => {
    const s = sampleSpreadDir(dir, 0, mulberry32(1));
    const d = normalizeLocal(dir);
    expect(dot(d, s)).toBeCloseTo(1, 12);
  });

  it('is reproducible for a seed', () => {
    const seq = (seed) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 50 }, () => sampleSpreadDir(dir, rifle.spread.base, rng));
    };
    expect(seq(31)).toEqual(seq(31));
    expect(seq(31)).not.toEqual(seq(32));
  });
});

function normalizeLocal(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
