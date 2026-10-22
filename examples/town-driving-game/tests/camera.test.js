import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCamState, applyOrbit, computePose } from '../src/camera.js';

const C = CONFIG.cam;
const DT = 1 / 60;
const target = (heading = 0, y = C.height) => ({ x: 0, y, z: 0, heading });

// Exact chase geometry for a state — the pose computePose snaps to on its first frame.
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

function run(cam, t, seconds) {
  let pose;
  for (let s = 0; s < seconds; s += DT) pose = computePose(cam, t, DT);
  return pose;
}

describe('createCamState', () => {
  it('starts centred behind the car at the default pitch and distance', () => {
    const cam = createCamState();
    expect(cam.yaw).toBe(0);
    expect(cam.pitch).toBe(C.pitch0);
    expect(cam.dist).toBe(C.dist);
  });
});

describe('applyOrbit', () => {
  it('clamps pitch to [pitchMin, pitchMax]', () => {
    const cam = createCamState();
    applyOrbit(cam, { pitch: 10 });
    expect(cam.pitch).toBe(C.pitchMax);
    applyOrbit(cam, { pitch: -10 });
    expect(cam.pitch).toBe(C.pitchMin);
  });

  it('clamps zoom to [minDist, maxDist]', () => {
    const cam = createCamState();
    applyOrbit(cam, { zoom: 100 });
    expect(cam.dist).toBe(C.maxDist);
    applyOrbit(cam, { zoom: -100 });
    expect(cam.dist).toBe(C.minDist);
  });
});

describe('computePose chase geometry', () => {
  it('snaps behind the car on the first frame', () => {
    const cam = createCamState();
    const t = target();
    const pose = computePose(cam, t, DT);
    const g = geom(cam, t);
    expect(pose.x).toBeCloseTo(g.x, 10);
    expect(pose.y).toBeCloseTo(g.y, 10);
    expect(pose.z).toBeCloseTo(g.z, 10);
    expect(pose.x).toBeCloseTo(0, 9);
    expect(pose.z).toBeLessThan(0); // heading 0 faces +z, camera sits behind
  });

  it('drag rotates the camera around the car', () => {
    const cam = createCamState();
    const t = target();
    applyOrbit(cam, { yaw: Math.PI / 2 });
    const pose = computePose(cam, t, DT);
    const cp = Math.cos(cam.pitch);
    expect(pose.x).toBeCloseTo(-cp * cam.dist, 6); // a quarter turn to the side
    expect(pose.z).toBeCloseTo(0, 6);
  });

  it('yaw is relative to heading: no drag keeps the camera behind a turning car', () => {
    const cam = createCamState();
    const pose = computePose(cam, target(Math.PI / 2), DT);
    expect(pose.x).toBeCloseTo(-Math.cos(cam.pitch) * cam.dist, 6); // heading π/2 faces +x
    expect(pose.z).toBeCloseTo(0, 6);
  });

  it('follows the target with exponential smoothing, never teleporting', () => {
    const cam = createCamState();
    computePose(cam, target(), DT); // snap
    const t2 = { ...target(), x: 100 };
    const p1 = computePose(cam, t2, DT);
    expect(p1.x).toBeGreaterThan(0);
    expect(p1.x).toBeLessThan(50); // one frame shaves a slice, not everything
    const pEnd = run(cam, t2, 10);
    expect(pEnd.x).toBeCloseTo(geom(cam, t2).x, 3);
  });
});

describe('computePose ground clamp', () => {
  it('never puts the camera below y = 0.9', () => {
    const cam = createCamState();
    applyOrbit(cam, { pitch: -10 }); // lowest pitch, aim point on the ground
    const t = target(0, 0);
    for (let s = 0; s < 5; s += DT) {
      expect(computePose(cam, t, DT).y).toBeGreaterThanOrEqual(0.9);
    }
    expect(cam.y).toBeCloseTo(0.9, 9); // sin(pitchMin) * dist alone would sit at ~0.84
  });

  it('stays above ground while following a low target from high up', () => {
    const cam = createCamState();
    run(cam, target(0, 40), 2); // high pose
    for (let s = 0; s < 5; s += DT) {
      expect(computePose(cam, target(0, 0), DT).y).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe('ease-back behind the car', () => {
  it('holds the orbit for 1.5 s after the drag, then eases to 0', () => {
    const cam = createCamState();
    const t = target();
    applyOrbit(cam, { yaw: 1 });
    run(cam, t, 1.4);
    expect(cam.yaw).toBeCloseTo(1, 6); // still holding
    run(cam, t, 5);
    expect(Math.abs(cam.yaw)).toBeLessThan(0.01); // glided back behind the car
  });

  it('a new drag restarts the hold', () => {
    const cam = createCamState();
    const t = target();
    applyOrbit(cam, { yaw: 1 });
    run(cam, t, 1.4);
    applyOrbit(cam, { pitch: 0.01 }); // any drag input resets the timer
    run(cam, t, 1.4);
    expect(cam.yaw).toBeCloseTo(1, 6);
  });
});
