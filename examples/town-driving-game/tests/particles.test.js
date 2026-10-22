import { describe, it, expect } from 'vitest';
import { createParticles, spawn, stepParticles, burstSparks, puffSmoke } from '../src/fx/particles.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const EPS = 1e-5; // slots are Float32Array, so doubles round on the way in
const px = (p, i, c) => p.pos[i * 3 + c];
const vx = (p, i, c) => p.vel[i * 3 + c];
const alive = (p) => p.life.filter((l) => l > 0).length;

describe('createParticles', () => {
  it('starts with the configured pool, every slot parked offscreen', () => {
    const p = createParticles();
    expect(p.capacity).toBe(CONFIG.fx.particles);
    expect(p.pos.length).toBe(CONFIG.fx.particles * 3);
    expect(alive(p)).toBe(0);
    for (let i = 0; i < p.capacity; i++) expect(px(p, i, 1)).toBeLessThan(-1000);
  });
});

describe('spawn', () => {
  it('writes position, velocity, colour and life into the next slot', () => {
    const p = createParticles(4);
    const i = spawn(p, 1, 2, 3, 4, 5, 6, 0.5, 1, 0.6, 0.2);
    expect(i).toBe(0);
    expect([px(p, 0, 0), px(p, 0, 1), px(p, 0, 2)]).toEqual([1, 2, 3]);
    expect([vx(p, 0, 0), vx(p, 0, 1), vx(p, 0, 2)]).toEqual([4, 5, 6]);
    expect(p.col[0]).toBeCloseTo(1, 6);
    expect(p.col[1]).toBeCloseTo(0.6, 6);
    expect(p.col[2]).toBeCloseTo(0.2, 6);
    expect(p.life[0]).toBeCloseTo(0.5, 6);
    expect(p.head).toBe(1);
  });

  it('recycles the oldest slot once the pool is full and never grows', () => {
    const p = createParticles(3);
    for (let k = 0; k < 3; k++) spawn(p, k, 0, 0, 0, 0, 0, 1, 0, 0, 0);
    expect(alive(p)).toBe(3);

    spawn(p, 99, 0, 0, 0, 0, 0, 1, 0, 0, 0); // overwrites slot 0
    expect(p.pos.length).toBe(9);
    expect(alive(p)).toBe(3);
    expect(px(p, 0, 0)).toBe(99);
    expect(px(p, 1, 0)).toBe(1); // the rest shift out one at a time
    expect(px(p, 2, 0)).toBe(2);
    expect(p.head).toBe(1);
  });
});

describe('stepParticles', () => {
  it('pulls a particle down by its gravity and integrates its position', () => {
    const p = createParticles(2);
    spawn(p, 0, 5, 0, 2, 0, 0, 1, 1, 1, 1, 10);
    stepParticles(p, 0.1);
    expect(vx(p, 0, 1)).toBeCloseTo(-1, 6);
    expect(px(p, 0, 1)).toBeCloseTo(5 - 0.1, 6);
    expect(px(p, 0, 0)).toBeCloseTo(0.2, 6);
    expect(p.life[0]).toBeCloseTo(0.9, 6);
  });

  it('parks a particle offscreen the moment its life runs out', () => {
    const p = createParticles(2);
    spawn(p, 4, 3, 2, 1, 1, 1, 0.05, 1, 1, 1, 10);
    stepParticles(p, 0.1);
    expect(p.life[0]).toBe(0);
    expect(px(p, 0, 1)).toBeLessThan(-1000);
  });

  it('leaves a dead slot alone on later frames', () => {
    const p = createParticles(2);
    spawn(p, 4, 3, 2, 1, 1, 1, 0.05, 1, 1, 1, 10);
    stepParticles(p, 0.1);
    stepParticles(p, 0.1);
    expect(px(p, 0, 1)).toBeLessThan(-1000);
    expect(px(p, 0, 0)).toBeCloseTo(4, 6); // no drift while parked
  });
});

describe('burstSparks', () => {
  it('throws n sparks from the contact point', () => {
    const p = createParticles(32);
    burstSparks(p, createRng(1), 7, 0.7, -3, 12);
    expect(alive(p)).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(px(p, i, 0)).toBe(7);
      expect(px(p, i, 1)).toBeCloseTo(0.7, 5);
      expect(px(p, i, 2)).toBe(-3);
    }
  });

  it('launches them up and out with a short warm life', () => {
    const p = createParticles(64);
    const rng = createRng(7);
    burstSparks(p, rng, 0, 0, 0, 20);
    for (let i = 0; i < 20; i++) {
      expect(vx(p, i, 1)).toBeGreaterThan(2 - EPS);
      expect(vx(p, i, 1)).toBeLessThan(7 + EPS);
      expect(Math.abs(vx(p, i, 0))).toBeLessThan(5 + EPS);
      expect(p.life[i]).toBeGreaterThan(0.25 - EPS);
      expect(p.life[i]).toBeLessThan(0.55 + EPS);
      expect(p.col[i * 3]).toBe(1); // hot orange, falling under plain gravity
      expect(p.col[i * 3 + 1]).toBeGreaterThan(0.55 - EPS);
      expect(p.grav[i]).toBeCloseTo(9, 5);
    }
  });

  it('replays identically for the same seed', () => {
    const a = createParticles(16);
    const b = createParticles(16);
    burstSparks(a, createRng(3), 1, 1, 1, 8);
    burstSparks(b, createRng(3), 1, 1, 1, 8);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(Array.from(a.vel)).toEqual(Array.from(b.vel));
  });
});

describe('puffSmoke', () => {
  it('adds one rising grey puff', () => {
    const p = createParticles(8);
    puffSmoke(p, createRng(5), 2, 1.1, 4);
    expect(alive(p)).toBe(1);
    expect(px(p, 0, 0)).toBe(2);
    expect(px(p, 0, 2)).toBe(4);
    expect(vx(p, 0, 1)).toBeGreaterThan(1.2 - EPS); // upward
    expect(Math.abs(vx(p, 0, 0))).toBeLessThan(0.5 + EPS); // barely any sideways
    expect(p.col[0]).toBeCloseTo(0.35, 5);
    expect(p.col[1]).toBeCloseTo(0.35, 5);
    expect(p.col[2]).toBeCloseTo(0.37, 5);
    expect(p.grav[0]).toBeCloseTo(0.6, 5); // nearly buoyant: it hangs instead of dropping
  });

  it('climbs before gravity takes it back down', () => {
    const p = createParticles(8);
    puffSmoke(p, createRng(11), 0, 1, 0);
    stepParticles(p, 0.2);
    expect(px(p, 0, 1)).toBeGreaterThan(1);
    stepParticles(p, 2);
    expect(p.life[0]).toBe(0);
    expect(px(p, 0, 1)).toBeLessThan(-1000);
  });
});
