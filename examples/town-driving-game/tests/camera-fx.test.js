import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCamState, applyOrbit, computePose, addShake, updateFov } from '../src/camera.js';

const C = CONFIG.cam;
const MAX = CONFIG.car.maxSpeed;
const DT = 1 / 60;
const target = (heading = 0, y = C.height) => ({ x: 0, y, z: 0, heading });

// Exact chase geometry for a state — what computePose settles to, i.e. the un-shaken pose.
function geom(cam, t) {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const yawW = t.heading + Math.PI + cam.yaw;
  return {
    x: t.x + Math.sin(yawW) * cp * cam.dist,
    y: Math.max(0.9, t.y + sp * cam.dist),
    z: t.z + Math.cos(yawW) * cp * cam.dist,
  };
}

// Frame counts, not seconds: the shake decay test needs an exact number of dt steps.
function poseFrames(cam, t, n) {
  let pose;
  for (let i = 0; i < n; i++) pose = computePose(cam, t, DT);
  return pose;
}

function fovFrames(cam, speed, n) {
  let fov;
  for (let i = 0; i < n; i++) fov = updateFov(cam, speed, DT);
  return fov;
}

describe('updateFov', () => {
  it('starts at the config fov', () => {
    expect(createCamState().fov).toBe(C.fov);
  });

  it('settles on fovMax at full speed and stays at fov when parked', () => {
    expect(fovFrames(createCamState(), MAX, 300)).toBeCloseTo(C.fovMax, 3);
    expect(fovFrames(createCamState(), 0, 300)).toBeCloseTo(C.fov, 9);
  });

  it('grows with the speed ratio', () => {
    const fovs = [0, 0.25, 0.5, 0.75, 1].map((r) => fovFrames(createCamState(), r * MAX, 300));
    expect(fovs[0]).toBeCloseTo(C.fov, 3);
    expect(fovs[fovs.length - 1]).toBeCloseTo(C.fovMax, 3);
    for (let i = 1; i < fovs.length; i++) expect(fovs[i]).toBeGreaterThan(fovs[i - 1]);
  });

  it('clamps past maxSpeed and widens for reverse as well', () => {
    expect(fovFrames(createCamState(), MAX * 3, 300)).toBeCloseTo(C.fovMax, 3);
    expect(fovFrames(createCamState(), -MAX, 300)).toBeCloseTo(fovFrames(createCamState(), MAX, 300), 9);
  });

  it('eases to the target fov instead of jumping', () => {
    const fov = updateFov(createCamState(), MAX, DT);
    expect(fov).toBeGreaterThan(C.fov);
    expect(fov).toBeLessThan(C.fov + (C.fovMax - C.fov) / 2);
  });
});

describe('addShake', () => {
  it('accumulates impact energy and caps at full shake', () => {
    const cam = createCamState();
    addShake(cam, 0.4);
    addShake(cam, 0.4);
    expect(cam.shake).toBeCloseTo(0.8, 10);
    addShake(cam, 5);
    expect(cam.shake).toBe(1);
  });
});

describe('screen shake', () => {
  it('jitters the pose away from the clean chase pose', () => {
    const cam = createCamState();
    const t = target();
    poseFrames(cam, t, 12); // settle onto the chase pose
    addShake(cam, 1);
    const p = computePose(cam, t, DT);
    const g = geom(cam, t);
    expect(Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z)).toBeGreaterThan(0.02);
  });

  it('decays exponentially and stops jittering', () => {
    const cam = createCamState();
    const t = target();
    poseFrames(cam, t, 12);
    addShake(cam, 1);
    poseFrames(cam, t, 60); // 1 s of decay
    expect(cam.shake).toBeCloseTo(Math.exp(-4.5), 5);
    const p = poseFrames(cam, t, 120);
    expect(cam.shake).toBeLessThan(0.001);
    const g = geom(cam, t);
    expect(p.x).toBeCloseTo(g.x, 9); // jitter is a view offset, never fed back into the follow
    expect(p.y).toBeCloseTo(g.y, 9);
    expect(p.z).toBeCloseTo(g.z, 9);
  });

  it('never drops the camera below ground while shaking', () => {
    const cam = createCamState();
    applyOrbit(cam, { pitch: -10 }); // lowest pitch, aim point on the ground
    const t = target(0, 0);
    addShake(cam, 1);
    for (let i = 0; i < 120; i++) {
      expect(computePose(cam, t, DT).y).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('is deterministic: same seed and inputs give the same jitter', () => {
    const shakeRun = () => {
      const cam = createCamState();
      const t = target();
      poseFrames(cam, t, 12);
      addShake(cam, 0.8);
      return poseFrames(cam, t, 18);
    };
    expect(shakeRun()).toEqual(shakeRun());
  });
});
