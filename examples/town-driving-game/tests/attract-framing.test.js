import { describe, it, expect } from 'vitest';
import { attractPose } from '../src/ui/startScreen.js';

// The start screen centres its h1/h2 block on the frame, and the attract pose looks at
// the spawn — so the car the player is about to drive sits at exact frame centre, under
// the title. At 90 m out and 55 m up it was a few pixels there and the traffic and
// pedestrians stepping behind the scrim were unnoticeable; the pose has to come in.
const CENTER = { x: 12, z: -8 };
const horizontal = (p) => Math.hypot(p.x - CENTER.x, p.z - CENTER.z);

describe('attract orbit frames the car', () => {
  it('holds low enough that the car reads at frame centre', () => {
    expect(attractPose(0, CENTER).y).toBeLessThanOrEqual(32);
  });

  it('stays near enough to pick out the town life around it', () => {
    expect(horizontal(attractPose(0, CENTER))).toBeLessThanOrEqual(70);
  });
});
