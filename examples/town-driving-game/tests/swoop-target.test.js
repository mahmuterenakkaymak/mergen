// T82: the cinematic start handed swoopPose a target with no heading, so aimPose read
// target.heading as undefined and the camera flew to NaN for the whole 1.2 s swoop.
// chaseTarget is the one place that target is built, so the swoop cannot be handed a
// heading-less one again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGame, stepGame } from '../src/game.js';
import { chaseTarget, swoopPose } from '../src/camera.js';
import { attractPose } from '../src/ui/startScreen.js';
import { createInputState, toControls } from '../src/input.js';

const finite = (n) => Number.isFinite(n);

describe('chaseTarget', () => {
  it('carries the car position, the chase height and the heading', () => {
    const world = createGame();
    const t = chaseTarget(world);
    expect(t).toEqual({
      x: world.car.x,
      y: world.cfg.cam.height,
      z: world.car.z,
      heading: world.car.heading,
    });
  });

  it('keeps the swoop pose finite at every t through it', () => {
    const world = createGame();
    stepGame(world, toControls(createInputState()), 1 / 60); // one idle frame, as the game runs it
    const from = attractPose(0, world.town.spawn);
    for (const t of [0, 0.5, 1]) {
      const p = swoopPose(t, from, world.cam, chaseTarget(world), world.town.buildings);
      expect([p.x, p.y, p.z, p.lookAt.x, p.lookAt.y, p.lookAt.z].every(finite)).toBe(true);
    }
  });
});

describe('the start swoop is driven off chaseTarget', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  it('hands the swoop and the aim the headed target, never a bare {x, y, z}', () => {
    expect(src).toMatch(/chaseTarget\(world\)/);
    expect(src).not.toMatch(/aim = \{ x: world\.car\.x/);
  });
});
