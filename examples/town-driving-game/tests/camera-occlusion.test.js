import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCamState, computePose } from '../src/camera.js';

const C = CONFIG.cam;
const DT = 1 / 60;
const AIM = { x: 0, y: C.height, z: 0, heading: 0 }; // heading 0 faces +z: the camera sits at -z
const FLOOR = C.minDist * 0.5;

// A building spanning the road, its faces at z0..z1 (a negative z0 is behind the car at
// heading 0) and `height` metres tall — the shape town.buildings carries.
const wallAt = (z0, z1, height = 12) => [{ x: -30, z: z0, w: 60, d: z1 - z0, height }];

function run(cam, t, buildings, seconds) {
  let pose;
  for (let s = 0; s < seconds; s += DT) pose = computePose(cam, t, DT, buildings);
  return pose;
}

// Distance from the aim point: the chase pose sits exactly cam.dist out, occlusion pulls
// it in along the same line.
const reach = (pose, t = AIM) => Math.hypot(pose.x - t.x, pose.y - t.y, pose.z - t.z);

describe('occlusion pull-in', () => {
  it('keeps the full chase pose when the view is clear', () => {
    const p = run(createCamState(), AIM, undefined, 3);
    expect(reach(p)).toBeCloseTo(C.dist, 4);
    expect(p.z).toBeLessThan(-9); // still the wide view behind the car
    expect(run(createCamState(), AIM, [], 3).z).toBeCloseTo(p.z, 9); // an empty town too
  });

  it('slides the camera in front of a building between the car and the camera', () => {
    const p = run(createCamState(), AIM, wallAt(-8, -6), 3);
    expect(p.z).toBeGreaterThan(-6); // in front of the wall face, not behind it
    expect(p.z).toBeLessThan(-5); // and just before it, not dumped at the car
    expect(reach(p)).toBeLessThan(C.dist);
    expect(reach(p)).toBeGreaterThan(FLOOR);
  });

  it('pulls in along the aim→camera line instead of lifting the view', () => {
    const p = run(createCamState(), AIM, wallAt(-8, -6), 3);
    expect(p.x).toBeCloseTo(0, 6);
    expect((p.y - AIM.y) / -p.z).toBeCloseTo(Math.tan(C.pitch0), 6); // same pitch, nearer
  });

  it('ignores a building the camera passes over or beside', () => {
    const clear = run(createCamState(), AIM, [], 3);
    const over = run(createCamState(), AIM, wallAt(-8, -6, 2), 3); // 2 m tall, ray at ~4 m
    expect(over.z).toBeCloseTo(clear.z, 9);
    expect(over.y).toBeCloseTo(clear.y, 9);
    const beside = run(createCamState(), AIM, [{ x: 20, z: -8, w: 10, d: 2, height: 12 }], 3);
    expect(beside.z).toBeCloseTo(clear.z, 9);
  });

  it('never pulls the camera closer than minDist / 2', () => {
    const p = run(createCamState(), AIM, wallAt(-4, -2), 3); // a face no margin can clear
    expect(reach(p)).toBeCloseTo(FLOOR, 4);
    expect(p.z).toBeLessThan(0); // still behind the car, looking at it
  });

  it('pulls in for the nearest building of several', () => {
    const p = run(createCamState(), AIM, [...wallAt(-10, -8), ...wallAt(-6, -4)], 3);
    expect(p.z).toBeGreaterThan(-4); // in front of the near face, not the far one
    expect(p.z).toBeLessThan(-3.2);
  });

  it('eases in instead of teleporting', () => {
    const cam = createCamState();
    run(cam, AIM, [], 2); // settled at the full distance
    const boxes = wallAt(-8, -6);
    const one = computePose(cam, AIM, DT, boxes);
    expect(reach(one)).toBeLessThan(C.dist);
    expect(reach(one)).toBeGreaterThan(9.5); // one frame shaves a slice, not the pull
    const settled = run(cam, AIM, boxes, 3);
    expect(settled.z).toBeGreaterThan(-6); // and glides to just before the wall
  });

  it('guards the line the camera is actually on, not the world behind the car', () => {
    const ahead = { ...AIM, heading: Math.PI }; // the camera now sits at +z
    expect(run(createCamState(), ahead, [], 3).z).toBeGreaterThan(9);
    const p = run(createCamState(), ahead, wallAt(6, 8), 3);
    expect(p.z).toBeLessThan(6); // pulled in before the wall it would have shown
    expect(p.z).toBeGreaterThan(0);
  });
});
