import { describe, expect, it } from 'vitest';
import { boxFromMinMax, containsPoint, intersects, makeBox, resolveMove } from '../src/core/aabb.js';

const PLAYER = { x: 0.6, y: 1.8, z: 0.6 };

// Box standing with its feet at (x, y, z).
function feetAt(x, y, z) {
  return makeBox({ x, y: y + PLAYER.y / 2, z }, PLAYER);
}

const WALL = boxFromMinMax({ x: 0, y: 0, z: -5 }, { x: 1, y: 2, z: 5 });
const CRATE = boxFromMinMax({ x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 });
const CEILING = boxFromMinMax({ x: -2, y: 4, z: -2 }, { x: 2, y: 5, z: 2 });

describe('makeBox / boxFromMinMax', () => {
  it('builds a box from center and size', () => {
    const box = makeBox({ x: 2, y: 1, z: -3 }, { x: 2, y: 2, z: 2 });
    expect(box.min).toEqual({ x: 1, y: 0, z: -4 });
    expect(box.max).toEqual({ x: 3, y: 2, z: -2 });
  });

  it('accepts arrays as well as {x,y,z}', () => {
    expect(makeBox([0, 0, 0], [2, 2, 2])).toEqual(boxFromMinMax([-1, -1, -1], [1, 1, 1]));
  });
});

describe('intersects / containsPoint', () => {
  it('treats flush contact as no overlap', () => {
    const a = boxFromMinMax({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const b = boxFromMinMax({ x: 1, y: 0, z: 0 }, { x: 2, y: 1, z: 1 });
    expect(intersects(a, b)).toBe(false);
    expect(intersects(a, shiftX(b, -0.5))).toBe(true);
  });

  it('includes the box surface', () => {
    const box = boxFromMinMax({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(containsPoint(box, { x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
    expect(containsPoint(box, { x: 1, y: 1, z: 1 })).toBe(true);
    expect(containsPoint(box, { x: 1.5, y: 0.5, z: 0.5 })).toBe(false);
  });
});

function shiftX(box, amount) {
  return boxFromMinMax(
    { x: box.min.x + amount, y: box.min.y, z: box.min.z },
    { x: box.max.x + amount, y: box.max.y, z: box.max.z },
  );
}

describe('resolveMove', () => {
  it('stops flush against a wall without penetrating', () => {
    const player = feetAt(-1, 0, 0);
    const result = resolveMove(player, { x: 1, y: 0, z: 0 }, [WALL]);

    expect(result.box.max.x).toBeCloseTo(0);
    expect(intersects(result.box, WALL)).toBe(false);
    expect(result.hitWall).toBe(true);
    expect(result.onGround).toBe(false);
  });

  it('keeps the tangential component so the body slides along the wall', () => {
    const player = feetAt(-1, 0, 0);
    const result = resolveMove(player, { x: 1, y: 0, z: 2 }, [WALL]);

    expect(result.box.max.x).toBeCloseTo(0);
    expect(result.box.min.z).toBeCloseTo(player.min.z + 2);
    expect(result.hitWall).toBe(true);
  });

  it('lands on a crate and reports onGround', () => {
    const result = resolveMove(feetAt(0, 2, 0), { x: 0, y: -1.5, z: 0 }, [CRATE]);

    expect(result.box.min.y).toBeCloseTo(1);
    expect(result.onGround).toBe(true);
    expect(result.hitCeiling).toBe(false);
  });

  it('stays grounded while resting flush with no vertical movement', () => {
    const landed = feetAt(0, 1, 0);
    const result = resolveMove(landed, { x: 0.2, y: 0, z: 0 }, [CRATE]);

    expect(result.onGround).toBe(true);
    expect(result.hitWall).toBe(false);
    expect(result.box.min.y).toBeCloseTo(1);
    expect(result.box.min.x).toBeCloseTo(landed.min.x + 0.2);
  });

  it('stops upward motion at a ceiling', () => {
    const result = resolveMove(feetAt(0, 2, 0), { x: 0, y: 0.5, z: 0 }, [CEILING]);

    expect(result.box.max.y).toBeCloseTo(4);
    expect(result.hitCeiling).toBe(true);
    expect(result.onGround).toBe(false);
  });

  it('moves freely when nothing is in the way', () => {
    const player = feetAt(5, 0, 5);
    const result = resolveMove(player, { x: 1, y: 0, z: -2 }, [CRATE]);

    expect(result.box.min.x).toBeCloseTo(player.min.x + 1);
    expect(result.box.min.z).toBeCloseTo(player.min.z - 2);
    expect(result.hitWall).toBe(false);
  });

  it('never mutates the input box', () => {
    const player = feetAt(-1, 0, 0);
    resolveMove(player, { x: 1, y: 0, z: 0 }, [WALL]);

    expect(player.min.x).toBeCloseTo(-1.3);
    expect(player.max.x).toBeCloseTo(-0.7);
  });
});
