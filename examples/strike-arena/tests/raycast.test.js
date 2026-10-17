import { describe, expect, it } from 'vitest';
import { BOTS, WEAPONS } from '../src/config.js';
import { makeBox } from '../src/core/aabb.js';
import { applyDamage, castHitscan, rayAabb } from '../src/core/raycast.js';

const { pistol, rifle, sniper } = WEAPONS;

// A bot standing at (x, z) on the floor, built from the same config numbers the
// real hitboxes use, so the tests exercise the geometry the game will have.
function botAt(id, x, z) {
  return {
    id,
    body: makeBox({ x, y: BOTS.bodyHeight / 2, z }, { x: BOTS.bodyWidth, y: BOTS.bodyHeight, z: BOTS.bodyWidth }),
    head: makeBox(
      { x, y: BOTS.bodyHeight + BOTS.headSize / 2, z },
      { x: BOTS.headSize, y: BOTS.headSize, z: BOTS.headSize },
    ),
  };
}

const EYE = { x: 0, y: 1.65, z: 0 }; // standing eye height, looking down -Z
const FORWARD = { x: 0, y: 0, z: -1 };
const WALL = makeBox({ x: 0, y: 1.5, z: -5 }, { x: 2, y: 3, z: 0.5 });

describe('rayAabb', () => {
  // Tall enough that the eye-height ray is level with the box rather than over it.
  const slab = () => makeBox({ x: 0, y: 1.5, z: -5 }, { x: 2, y: 3, z: 2 });

  it('returns the distance to the near face and a face normal pointing back at the ray', () => {
    const box = slab();
    const hit = rayAabb(EYE, FORWARD, box);
    expect(hit.t).toBeCloseTo(4, 9);
    expect(hit.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('puts the hit point on the face it reports', () => {
    const box = slab();
    const hit = rayAabb(EYE, FORWARD, box);
    expect(hit.point.z).toBeCloseTo(box.max.z, 9);
    expect(hit.point.x).toBeCloseTo(EYE.x, 9);
    expect(hit.point.y).toBeCloseTo(EYE.y, 9);
  });

  it('reports the axis the ray actually crosses first on an angled shot', () => {
    const box = makeBox({ x: 4, y: 0, z: -1 }, { x: 2, y: 2, z: 2 });
    const hit = rayAabb({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box);
    expect(hit.t).toBeCloseTo(3, 9);
    expect(hit.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('misses a box the ray passes beside', () => {
    const box = makeBox({ x: 10, y: 0, z: -5 }, { x: 1, y: 1, z: 1 });
    expect(rayAabb(EYE, FORWARD, box)).toBeNull();
  });

  it('misses a box behind the origin', () => {
    const box = makeBox({ x: 0, y: 0, z: 5 }, { x: 2, y: 2, z: 2 });
    expect(rayAabb(EYE, FORWARD, box)).toBeNull();
  });

  it('measures t in metres for a non-unit direction', () => {
    const slow = rayAabb(EYE, { x: 0, y: 0, z: -0.001 }, slab());
    expect(slow.t).toBeCloseTo(4, 6);
  });

  it('returns null for a zero-length direction', () => {
    expect(rayAabb(EYE, { x: 0, y: 0, z: 0 }, makeBox({ x: 0, y: 0, z: -5 }, { x: 2, y: 2, z: 2 }))).toBeNull();
  });
});

describe('castHitscan', () => {
  it('registers a head shot at eye height on the target id', () => {
    const hit = castHitscan(EYE, FORWARD, 50, [], [botAt('bot1', 0, -10)]);
    expect(hit.kind).toBe('head');
    expect(hit.targetId).toBe('bot1');
    expect(hit.t).toBeCloseTo(10 - BOTS.headSize / 2, 9);
  });

  it('never counts a head ray as a body hit too', () => {
    const hit = castHitscan(EYE, FORWARD, 50, [], [botAt('bot1', 0, -10)]);
    expect(hit.kind).not.toBe('body');
  });

  it('registers a body shot at torso height', () => {
    const hit = castHitscan({ x: 0, y: 1, z: 0 }, FORWARD, 50, [], [botAt('bot1', 0, -10)]);
    expect(hit.kind).toBe('body');
    expect(hit.targetId).toBe('bot1');
    expect(hit.t).toBeCloseTo(10 - BOTS.bodyWidth / 2, 9);
  });

  it('takes the nearest target when one stands in front of another', () => {
    const targets = [botAt('far', 0, -10), botAt('near', 0, -6)];
    const hit = castHitscan({ x: 0, y: 1, z: 0 }, FORWARD, 50, [], targets);
    expect(hit.targetId).toBe('near');
  });

  it('is blocked by a wall between the shooter and the target, and reports the wall impact', () => {
    const hit = castHitscan(EYE, FORWARD, 50, [WALL], [botAt('bot1', 0, -10)]);
    expect(hit.kind).toBe('wall');
    expect(hit.targetId).toBeNull();
    expect(hit.t).toBeCloseTo(5 - 0.25, 9);
    expect(hit.point.z).toBeCloseTo(-4.75, 9);
    expect(hit.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(hit.t).toBeLessThan(10);
  });

  it('hits the target once the wall is out of the way', () => {
    const hit = castHitscan(EYE, FORWARD, 50, [], [botAt('bot1', 0, -10)]);
    expect(hit.kind).toBe('head');
  });

  it('ignores a wall behind the target', () => {
    const hit = castHitscan(EYE, FORWARD, 50, [WALL], [botAt('bot1', 0, -3)]);
    expect(hit.kind).toBe('head');
    expect(hit.targetId).toBe('bot1');
  });

  it('misses everything past the weapon range', () => {
    const targets = [botAt('bot1', 0, -10)];
    expect(castHitscan(EYE, FORWARD, 5, [], targets)).toBeNull();
    expect(castHitscan(EYE, FORWARD, 50, [], targets)).not.toBeNull();
  });

  it('misses a target standing off the aim line', () => {
    expect(castHitscan(EYE, FORWARD, 50, [], [botAt('bot1', 8, -10)])).toBeNull();
  });

  it('returns null when there is nothing to hit', () => {
    expect(castHitscan(EYE, { x: 0, y: 1, z: 0 }, 50, [], [])).toBeNull();
  });

  it('skips a target with no hitboxes, such as a dead bot', () => {
    const targets = [{ id: 'dead', head: null, body: null }, botAt('alive', 0, -10)];
    const hit = castHitscan(EYE, FORWARD, 50, [], targets);
    expect(hit.targetId).toBe('alive');
  });
});

describe('applyDamage', () => {
  const hitOn = (kind) => ({ kind, t: 1, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, targetId: 'b' });

  it('multiplies a head shot by the weapon headshot multiplier', () => {
    for (const def of [pistol, rifle, sniper]) {
      expect(applyDamage(hitOn('head'), def)).toBeCloseTo(def.damage * def.headshotMult, 9);
    }
  });

  it('deals base damage on a body shot', () => {
    for (const def of [pistol, rifle, sniper]) {
      expect(applyDamage(hitOn('body'), def)).toBe(def.damage);
    }
  });

  it('deals no damage to a wall', () => {
    expect(applyDamage(hitOn('wall'), rifle)).toBe(0);
  });

  it('deals no damage on a miss', () => {
    expect(applyDamage(null, rifle)).toBe(0);
  });

  it('kills a full-health bot with a sniper headshot', () => {
    const dmg = applyDamage(hitOn('head'), sniper);
    expect(dmg).toBeGreaterThanOrEqual(BOTS.health);
  });
});
