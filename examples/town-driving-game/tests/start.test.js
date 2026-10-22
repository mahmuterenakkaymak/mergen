import { describe, it, expect } from 'vitest';
import { attractPose, createStartScreen, LOOK_H } from '../src/ui/startScreen.js';

const CENTER = { x: 204, z: 204 };
const dist = (p, c = CENTER) => Math.hypot(p.x - c.x, p.z - c.z);
const angle = (p, c = CENTER) => Math.atan2(p.x - c.x, p.z - c.z);

describe('attractPose', () => {
  it('orbits the center at a fixed height', () => {
    const p0 = attractPose(0, CENTER);
    const p1 = attractPose(10, CENTER);
    const p2 = attractPose(37.5, CENTER);
    expect(p0.y).toBeGreaterThan(0);
    expect(p1.y).toBeCloseTo(p0.y, 9);
    expect(p2.y).toBeCloseTo(p0.y, 9);
    expect(dist(p1)).toBeCloseTo(dist(p0), 6);
    expect(dist(p2)).toBeCloseTo(dist(p0), 6);
  });

  it('moves along the circle, slowly', () => {
    const p0 = attractPose(0, CENTER);
    const p1 = attractPose(10, CENTER);
    expect(p1.x).not.toBeCloseTo(p0.x, 6);
    const sweep = Math.abs(angle(p1) - angle(p0)) / 10; // rad/s
    expect(sweep).toBeGreaterThan(0);
    expect(sweep).toBeLessThan(0.1); // a slow browse, not a spin
  });

  it('looks at the center', () => {
    const p = attractPose(5, CENTER);
    expect(p.lookAt.x).toBe(CENTER.x);
    expect(p.lookAt.z).toBe(CENTER.z);
    expect(p.lookAt.y).toBe(LOOK_H); // T78 raised the aim so the car sits in the lower third
  });

  it('orbits whatever center it is given', () => {
    const c = { x: -50, z: 12 };
    const p = attractPose(3, c);
    const ref = attractPose(3, CENTER);
    expect(dist(p, c)).toBeCloseTo(dist(ref), 6); // same radius, new center
    expect(p.x).not.toBeCloseTo(ref.x, 6);
  });
});

describe('createStartScreen', () => {
  it('is exported as a function (DOM builder, exercised in the browser)', () => {
    expect(typeof createStartScreen).toBe('function');
    expect(typeof attractPose).toBe('function');
  });
});
