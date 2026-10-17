import { describe, expect, it } from 'vitest';
import { LOOP } from '../src/config.js';
import { createFixedLoop } from '../src/core/loop.js';

const STEP = LOOP.step;
const stepsOf = (loop, dt) => loop.advance(dt).steps;

describe('createFixedLoop', () => {
  it('runs N steps for N steps worth of time', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    expect(stepsOf(loop, 3 * STEP)).toBe(3);
    expect(stepsOf(loop, 5 * STEP)).toBe(5);
    expect(stepsOf(loop, 10 * STEP)).toBe(10);
  });

  it('carries the leftover time into the next frame', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    expect(stepsOf(loop, STEP * 0.5)).toBe(0);
    expect(stepsOf(loop, STEP * 0.5)).toBe(1);
    expect(stepsOf(loop, STEP * 0.25)).toBe(0);
    expect(stepsOf(loop, STEP * 0.75)).toBe(1);
  });

  it('reports alpha as the fraction of a step still in the accumulator', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    expect(loop.advance(STEP * 1.5)).toEqual({ steps: 1, alpha: expect.closeTo(0.5, 6) });
    expect(loop.advance(0).alpha).toBeCloseTo(0.5, 6);

    const idle = createFixedLoop(STEP, LOOP.maxFrame);
    expect(idle.advance(0)).toEqual({ steps: 0, alpha: 0 });
  });

  it('caps one frame at maxFrame instead of catching up', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    const capped = stepsOf(loop, 10);
    expect(capped).toBe(Math.floor(LOOP.maxFrame / STEP));
    expect(capped).toBeLessThan(10 / STEP);

    const exact = createFixedLoop(STEP, LOOP.maxFrame);
    expect(stepsOf(exact, LOOP.maxFrame)).toBe(capped);
  });

  it('treats a missing, negative or non-finite frame delta as no time', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    expect(stepsOf(loop, undefined)).toBe(0);
    expect(stepsOf(loop, -1)).toBe(0);
    expect(stepsOf(loop, Number.NaN)).toBe(0);
    expect(stepsOf(loop, Number.POSITIVE_INFINITY)).toBe(0);
    expect(stepsOf(loop, STEP)).toBe(1);
  });

  it('reset drops the leftover time', () => {
    const loop = createFixedLoop(STEP, LOOP.maxFrame);
    expect(loop.advance(STEP * 0.9).alpha).toBeCloseTo(0.9, 6);
    loop.reset();
    expect(loop.advance(0)).toEqual({ steps: 0, alpha: 0 });
    expect(stepsOf(loop, STEP * 0.9)).toBe(0);
  });
});
