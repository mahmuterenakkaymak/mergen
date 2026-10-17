import { describe, expect, it } from 'vitest';
import { FALL, MOVEMENT, PLAYER } from '../src/config.js';
import { boxFromMinMax, intersects } from '../src/core/aabb.js';
import { applyLook, createPlayer, fallDamage, stepPlayer } from '../src/core/movement.js';

const DT = 1 / 60;

const FLOOR = boxFromMinMax({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 });
const WALL = boxFromMinMax({ x: 2, y: 0, z: -10 }, { x: 3, y: 3, z: 10 });
const LOW_CEILING = boxFromMinMax({ x: -2, y: 1.5, z: -2 }, { x: 2, y: 3, z: 2 });
const FLOORED = [FLOOR];

const IDLE = { forward: false, back: false, left: false, right: false, jump: false, walk: false, crouch: false };
const input = (over = {}) => ({ ...IDLE, ...over });

function run(player, seconds, inp, colliders = FLOORED) {
  let last = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) last = stepPlayer(player, inp, DT, colliders);
  return last;
}

const speed2d = (p) => Math.hypot(p.vel.x, p.vel.z);
const boxHeight = (b) => b.max.y - b.min.y;

describe('createPlayer', () => {
  it('stands with its feet at the spawn point', () => {
    const p = createPlayer({ x: 1.5, y: 2, z: -3 });
    expect(p.box.min.y).toBeCloseTo(2);
    expect(boxHeight(p.box)).toBeCloseTo(MOVEMENT.playerHeight);
    expect(p.box.min.x).toBeCloseTo(1.5 - MOVEMENT.playerWidth / 2);
    expect(p.box.max.z).toBeCloseTo(-3 + MOVEMENT.playerWidth / 2);
    expect(p.health).toBe(PLAYER.maxHealth);
    expect(p.onGround).toBe(false);
    expect(p.crouching).toBe(false);
  });
});

describe('applyLook', () => {
  it('turns yaw proportionally to sensitivity and never clamps it', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    applyLook(p, 100, 0, 1);
    const single = p.yaw;
    p.yaw = 0;
    applyLook(p, 100, 0, 2);
    expect(p.yaw).toBeCloseTo(single * 2);

    for (let i = 0; i < 10000; i++) applyLook(p, 1000, 0, 3);
    expect(Math.abs(p.yaw)).toBeGreaterThan(4 * Math.PI);
  });

  it('turns the view right when the mouse moves right', () => {
    const forwardX = (p) => -Math.sin(p.yaw);

    const p = createPlayer({ x: 0, y: 0, z: 0 });
    applyLook(p, 100, 0, 1);
    expect(forwardX(p)).toBeGreaterThan(0);

    p.yaw = 0;
    applyLook(p, -100, 0, 1);
    expect(forwardX(p)).toBeLessThan(0);
  });

  it('clamps pitch to +/-90 degrees in both directions', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 100; i++) applyLook(p, 0, 500, 3);
    expect(p.pitch).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9);
    expect(p.pitch).toBeLessThan(-1);

    for (let i = 0; i < 100; i++) applyLook(p, 0, -500, 3);
    expect(p.pitch).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(p.pitch).toBeGreaterThan(1);
  });
});

describe('stepPlayer speeds', () => {
  it('reaches run speed, and walking is slower than running', () => {
    const runner = createPlayer({ x: 0, y: 0, z: 0 });
    const walker = createPlayer({ x: 0, y: 0, z: 0 });
    run(runner, 2, input({ forward: true }));
    run(walker, 2, input({ forward: true, walk: true }));

    expect(speed2d(runner)).toBeCloseTo(MOVEMENT.runSpeed, 2);
    expect(speed2d(walker)).toBeCloseTo(MOVEMENT.walkSpeed, 2);
    expect(walker.box.min.z).toBeGreaterThan(runner.box.min.z); // runner got further toward -Z
  });

  it('crouch is slower than walk and shrinks the box and eye height', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    run(p, 2, input({ forward: true, crouch: true }));

    expect(p.crouching).toBe(true);
    expect(speed2d(p)).toBeLessThan(MOVEMENT.walkSpeed);
    expect(speed2d(p)).toBeCloseTo(MOVEMENT.crouchSpeed, 2);
    expect(boxHeight(p.box)).toBeCloseTo(MOVEMENT.crouchHeight);
    expect(p.eyeY).toBeCloseTo(MOVEMENT.crouchEyeHeight);
  });

  it('friction bleeds speed back to zero when no key is held', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    run(p, 1, input({ forward: true }));
    const moving = speed2d(p);
    run(p, 2, input());
    expect(speed2d(p)).toBeLessThan(moving * 0.01);
  });
});

describe('stepPlayer jump and gravity', () => {
  it('jumps only from the ground and cannot be repeated in the air', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    run(p, 0.2, input());
    expect(stepPlayer(p, input({ jump: true }), DT, FLOORED).onGround).toBe(false);
    expect(p.vel.y).toBeCloseTo(MOVEMENT.jumpSpeed);

    for (let i = 0; i < 600 && p.vel.y > 0; i++) stepPlayer(p, input(), DT, FLOORED);
    expect(p.onGround).toBe(false);

    const before = p.vel.y;
    stepPlayer(p, input({ jump: true }), DT, FLOORED);
    expect(p.vel.y).toBeCloseTo(before - MOVEMENT.gravity * DT);
    expect(p.vel.y).toBeLessThan(0);
  });

  it('lands after a jump and reports the fall height', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    run(p, 0.2, input());
    stepPlayer(p, input({ jump: true }), DT, FLOORED);

    let landed = null;
    for (let i = 0; i < 600 && landed === null; i++) landed = stepPlayer(p, input(), DT, FLOORED).landed;
    expect(landed).not.toBeNull();
    expect(landed).toBeGreaterThan(0.5);
    expect(landed).toBeLessThan(1.5);
    expect(p.onGround).toBe(true);
  });

  it('tracks a long fall and returns its height on landing', () => {
    const p = createPlayer({ x: 0, y: 10, z: 0 });
    let landed = null;
    for (let i = 0; i < 1200 && landed === null; i++) landed = stepPlayer(p, input(), DT, FLOORED).landed;

    expect(landed).not.toBeNull();
    expect(landed).toBeCloseTo(10, 3);
    expect(fallDamage(landed, FALL)).toBeGreaterThan(0);
  });
});

describe('stepPlayer collision', () => {
  it('cannot walk through a wall', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    p.yaw = -Math.PI / 2; // forward = +X, toward the wall
    run(p, 3, input({ forward: true }), [FLOOR, WALL]);

    expect(p.box.max.x).toBeLessThanOrEqual(WALL.min.x + 1e-6);
    expect(p.box.max.x).toBeCloseTo(WALL.min.x, 3);
    expect(intersects(p.box, WALL)).toBe(false);
  });

  it('stays crouched under a low ceiling and stands when it clears', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 });
    run(p, 0.2, input({ crouch: true }), [FLOOR, LOW_CEILING]);
    expect(p.crouching).toBe(true);

    run(p, 0.5, input(), [FLOOR, LOW_CEILING]);
    expect(p.crouching).toBe(true);
    expect(boxHeight(p.box)).toBeCloseTo(MOVEMENT.crouchHeight);

    run(p, 0.5, input(), FLOORED);
    expect(p.crouching).toBe(false);
    expect(boxHeight(p.box)).toBeCloseTo(MOVEMENT.playerHeight);
  });
});

describe('fallDamage', () => {
  it('is zero up to the safe height', () => {
    expect(fallDamage(0, FALL)).toBe(0);
    expect(fallDamage(FALL.safeHeight / 2, FALL)).toBe(0);
    expect(fallDamage(FALL.safeHeight, FALL)).toBe(0);
  });

  it('is strictly increasing above the safe height', () => {
    const a = fallDamage(FALL.safeHeight + 0.5, FALL);
    const b = fallDamage(FALL.safeHeight + 2, FALL);
    const c = fallDamage(FALL.safeHeight + 8, FALL);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(fallDamage(5, FALL)).toBeCloseTo((5 - FALL.safeHeight) * FALL.damagePerMeter);
  });
});
