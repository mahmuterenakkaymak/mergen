import { describe, it, expect } from 'vitest';
import { mulberry32, createRng } from '../src/util/rng.js';

const seq = (fn, n) => Array.from({ length: n }, fn);

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed', () => {
    expect(seq(mulberry32(1), 10)).toEqual(seq(mulberry32(1), 10));
    expect(seq(mulberry32(0), 8)).toEqual(seq(mulberry32(0), 8));
  });

  it('gives different sequences for different seeds', () => {
    expect(seq(mulberry32(1), 8)).not.toEqual(seq(mulberry32(2), 8));
    expect(seq(mulberry32(1), 8)).not.toEqual(seq(mulberry32(1001), 8));
  });

  it('stays in [0, 1)', () => {
    const r = mulberry32(20261020);
    for (let i = 0; i < 20000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads values over the unit interval', () => {
    const r = mulberry32(7);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) bins[Math.floor(r() * 10)]++;
    for (const b of bins) expect(b).toBeGreaterThan(1500);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(20000);
  });
});

describe('createRng', () => {
  it('is reproducible from the seed', () => {
    const a = createRng(20261020);
    const b = createRng(20261020);
    expect(seq(a.float, 20)).toEqual(seq(b.float, 20));
  });

  it('treats numeric and string seeds of the same text alike', () => {
    expect(seq(createRng(42).float, 8)).toEqual(seq(createRng('42').float, 8));
  });

  it('float() draws [0, 1) and range() maps onto the given interval', () => {
    const r = createRng(3);
    for (let i = 0; i < 5000; i++) {
      const v = r.range(-4, 6);
      expect(v).toBeGreaterThanOrEqual(-4);
      expect(v).toBeLessThan(6);
    }
    expect(r.range(2, 2)).toBe(2);
  });

  it('int() returns whole numbers inside the inclusive bounds', () => {
    const r = createRng(11);
    const seen = new Set();
    for (let i = 0; i < 4000; i++) {
      const v = r.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    expect(r.int(5, 5)).toBe(5);
  });

  it('pick() returns members of the list and keeps drawing', () => {
    const r = createRng(5);
    const items = ['a', 'b', 'c', 'd'];
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const v = r.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(items.length);
    const nums = [1, 2, 3];
    expect(nums).toContain(createRng(9).pick(nums));
  });
});

describe('fork', () => {
  it('is deterministic by label, whatever order the draws happened in', () => {
    const a = createRng(1);
    const b = createRng(1);
    seq(b.float, 500);
    expect(seq(a.fork('town').float, 12)).toEqual(seq(b.fork('town').float, 12));
  });

  it('gives every label its own stream', () => {
    const r = createRng(1);
    const town = seq(r.fork('town').float, 10);
    const facades = seq(r.fork('facades').float, 10);
    const traffic = seq(r.fork('traffic').float, 10);
    const peds = seq(r.fork('peds').float, 10);
    expect(town).not.toEqual(facades);
    expect(town).not.toEqual(traffic);
    expect(town).not.toEqual(peds);
    expect(facades).not.toEqual(traffic);
    expect(traffic).not.toEqual(peds);
  });

  it('leaves the parent stream untouched', () => {
    const r = createRng(77);
    const before = seq(r.fork('x').float, 5);
    const p1 = seq(r.float, 5);

    const r2 = createRng(77);
    seq(r2.fork('x').float, 5);
    const p2 = seq(r2.float, 5);
    expect(p1).toEqual(p2);
    expect(before).toEqual(seq(createRng(77).fork('x').float, 5));
  });

  it('does not shift other forks when one fork is added or consumed further', () => {
    const r = createRng('seed');
    const town = seq(r.fork('town').float, 10);
    seq(r.fork('peds').float, 1000);
    expect(seq(r.fork('town').float, 10)).toEqual(town);
    expect(seq(createRng('seed').fork('town').float, 10)).toEqual(town);
  });

  it('keeps nested forks separate from their parents and siblings', () => {
    const r = createRng(4);
    const parent = seq(r.fork('facades').float, 8);
    const windows = seq(r.fork('facades').fork('windows').float, 8);
    const roofs = seq(r.fork('facades').fork('roofs').float, 8);
    expect(windows).not.toEqual(parent);
    expect(windows).not.toEqual(roofs);
    expect(windows).toEqual(seq(createRng(4).fork('facades').fork('windows').float, 8));
  });

  it('separates forks of different roots', () => {
    expect(seq(createRng(1).fork('town').float, 8)).not.toEqual(
      seq(createRng(2).fork('town').float, 8)
    );
  });
});
