import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config.js';
import { createCamState, computePose, swoopPose, SWOOP_SECONDS } from '../src/camera.js';
import { attractPose, LOOK_H } from '../src/ui/startScreen.js';
import { createAudio } from '../src/audio/audio.js';

// The click that starts the game hands the camera from the attract orbit to the chase pose.
// swoopPose owns that glide, so the two ends are the contract: t=0 must be exactly the pose
// the orbit was already holding (or the swoop jumps on the first frame) and t=1 exactly the
// pose computePose snaps to (or it jumps again when the sim takes the camera back).
const C = CONFIG.cam;
const DT = 1 / 60;
const SPAWN = { x: 12, z: -30 }; // the attract orbit circles the spawn, not the origin
const target = { x: 12, y: C.height, z: -30, heading: 0.4 };

// The chase pose straight from the orbit geometry, as the follow aims at it.
function chase(cam, t) {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const yawW = t.heading + Math.PI + cam.yaw;
  return {
    x: t.x + Math.sin(yawW) * cp * cam.dist,
    y: Math.max(0.9, t.y + sp * cam.dist),
    z: t.z + Math.cos(yawW) * cp * cam.dist,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('swoopPose', () => {
  it('takes SWOOP_SECONDS, the duration the start is cut to', () => {
    expect(SWOOP_SECONDS).toBe(1.2);
  });

  it('starts exactly on the pose the attract orbit was holding', () => {
    const from = attractPose(7.5, SPAWN);
    const p = swoopPose(0, from, createCamState(), target);
    expect(p.x).toBe(from.x);
    expect(p.y).toBe(from.y);
    expect(p.z).toBe(from.z);
    expect(p.lookAt).toEqual({ x: SPAWN.x, y: LOOK_H, z: SPAWN.z }); // T78 aim height
  });

  it('ends exactly on the chase pose', () => {
    const cam = createCamState();
    const p = swoopPose(1, attractPose(7.5, SPAWN), cam, target);
    const g = chase(cam, target);
    expect(p.x).toBeCloseTo(g.x, 9);
    expect(p.y).toBeCloseTo(g.y, 9);
    expect(p.z).toBeCloseTo(g.z, 9);
    expect(p.lookAt).toEqual({ x: target.x, y: target.y, z: target.z });
  });

  it('hands over to computePose without a seam', () => {
    const cam = createCamState();
    const end = swoopPose(1, attractPose(7.5, SPAWN), cam, target);
    const pose = computePose(cam, target, DT); // its first frame snaps to the chase pose
    expect(end.x).toBeCloseTo(pose.x, 9);
    expect(end.y).toBeCloseTo(pose.y, 9);
    expect(end.z).toBeCloseTo(pose.z, 9);
  });

  it('lands on the pulled-in pose when a building blocks the chase view', () => {
    // Sits across the aim→camera line, so the chase pose it lands on is the short one.
    const buildings = [{ x: 6, z: -36, w: 4, d: 2, height: 8 }];
    const cam = createCamState();
    const end = swoopPose(1, attractPose(7.5, SPAWN), cam, target, buildings);
    const pose = computePose(cam, target, DT, buildings);
    expect(end.x).toBeCloseTo(pose.x, 9);
    expect(end.y).toBeCloseTo(pose.y, 9);
    expect(end.z).toBeCloseTo(pose.z, 9);
    expect(dist(end, chase(cam, target))).toBeGreaterThan(0.5); // it really did pull in
  });

  it('falls monotonically and closes on the chase pose the whole way', () => {
    const cam = createCamState();
    const from = attractPose(7.5, SPAWN);
    const to = chase(cam, target);
    let prev = swoopPose(0, from, cam, target);
    let prevGap = dist(prev, to);
    for (let i = 1; i <= 120; i++) {
      const p = swoopPose(i / 120, from, cam, target);
      expect(p.y).toBeLessThan(prev.y);
      expect(dist(p, to)).toBeLessThan(prevGap);
      prev = p;
      prevGap = dist(p, to);
    }
  });

  it('eases in and out instead of sliding at a constant rate', () => {
    const cam = createCamState();
    const from = attractPose(7.5, SPAWN);
    const to = chase(cam, target);
    // Height is the axis the swoop travels most, so read the eased progress off it.
    const progress = (t) => (from.y - swoopPose(t, from, cam, target).y) / (from.y - to.y);
    expect(progress(0.25)).toBeLessThan(0.25); // still leaning on the starter
    expect(progress(0.5)).toBeCloseTo(0.5, 9); // symmetric: half way, half down
    expect(progress(0.75)).toBeGreaterThan(0.75); // ...and the back half is the fast one
  });

  it('clamps t to the swoop at both ends', () => {
    const cam = createCamState();
    const from = attractPose(7.5, SPAWN);
    const early = swoopPose(-3, from, cam, target);
    expect(early.y).toBe(from.y);
    const late = swoopPose(9, from, cam, target);
    const g = chase(cam, target);
    expect(late.x).toBeCloseTo(g.x, 9);
    expect(late.y).toBeCloseTo(g.y, 9);
    expect(late.z).toBeCloseTo(g.z, 9);
  });
});

describe('the start screen hands over', () => {
  // main.js is wiring, but the swoop only happens if it drives it: the pose, the crank that
  // plays under it, and the GO! that lands with the camera.
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  it('runs the swoop, the ignition and the GO! toast off the start click', () => {
    expect(src).toMatch(/swoopPose\(/);
    expect(src).toMatch(/SWOOP_SECONDS/);
    expect(src).toMatch(/audio\.ignition\(\)/);
    expect(src).toMatch(/toasts\.show\('GO!'\)/);
  });

  it('fades the overlay out on the same click', () => {
    const start = readFileSync(new URL('../src/ui/startScreen.js', import.meta.url), 'utf8');
    expect(start).toMatch(/classList\.add\('hide'\)/);
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/#start\.hide \{ opacity: 0/);
  });
});

describe('audio.ignition', () => {
  it('exists and is a no-op in Node, like every other audio call', () => {
    const a = createAudio();
    expect(typeof a.ignition).toBe('function');
    expect(() => a.ignition()).not.toThrow();
  });
});
