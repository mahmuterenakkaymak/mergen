import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import {
  createCameraKick,
  createMouseSway,
  damageIndicatorAngle,
  landingDip,
  scopeFov,
  viewBob,
} from '../src/core/feel.js';

const FRAME = 1 / 60;
const WALK_RATIO = CONFIG.MOVEMENT.walkSpeed / CONFIG.MOVEMENT.runSpeed;

// Peak of the vertical bob over several cycles: the bob is a wave, so a single sample
// says nothing about how big it is.
function bobPeak(speedRatio, crouched) {
  let peak = 0;
  for (let t = 0; t <= 8; t += FRAME) {
    peak = Math.max(peak, Math.abs(viewBob(t, speedRatio, crouched).y));
  }
  return peak;
}

describe('viewBob', () => {
  it('is exactly zero while standing still', () => {
    for (let t = 0; t <= 8; t += FRAME) {
      expect(viewBob(t, 0)).toEqual({ x: 0, y: 0 });
    }
  });

  it('swings wider running than walking', () => {
    const running = bobPeak(1, false);
    const walking = bobPeak(WALK_RATIO, false);
    expect(running).toBeGreaterThan(0);
    expect(walking).toBeGreaterThan(0);
    // Amplitude is linear in the speed ratio, so the peak ratio tracks the speed ratio.
    expect(running / walking).toBeGreaterThan(1 / WALK_RATIO - 0.3);
  });

  it('stays low while crouched', () => {
    expect(bobPeak(1, true)).toBeLessThan(bobPeak(1, false));
  });

  it('keeps the side-to-side swing inside the vertical one', () => {
    let side = 0;
    for (let t = 0; t <= 8; t += FRAME) side = Math.max(side, Math.abs(viewBob(t, 1).x));
    expect(side).toBeLessThan(CONFIG.FEEL.bobUp);
    expect(side).toBeCloseTo(CONFIG.FEEL.bobSide, 2);
  });

  it('clamps a ratio above 1 instead of growing forever', () => {
    expect(viewBob(0.4, 1)).toEqual(viewBob(0.4, 3));
  });

  it('does not jump the phase when the speed changes', () => {
    // Late in a session, a ratio folded into the phase would re-scale all 600 s of elapsed
    // time and move the offset by half the bob on a 1% speed change.
    const a = viewBob(600, 0.5);
    const b = viewBob(600, 0.51);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.005);
  });
});

describe('createMouseSway', () => {
  it('rests at the centre with no mouse motion', () => {
    const sway = createMouseSway();
    for (let i = 0; i < 60; i++) sway.update(FRAME, 0, 0);
    expect(sway.x).toBe(0);
    expect(sway.y).toBe(0);
  });

  it('trails a left turn: the gun lags to the right', () => {
    const sway = createMouseSway();
    sway.update(FRAME, 0.05, 0);
    expect(sway.x).toBeGreaterThan(0);
  });

  it('drops below rest when looking up', () => {
    const sway = createMouseSway();
    sway.update(FRAME, 0, 0.05);
    expect(sway.y).toBeLessThan(0);
  });

  it('catches back up once the mouse stops', () => {
    const sway = createMouseSway();
    for (let i = 0; i < 5; i++) sway.update(FRAME, 0.05, 0.05);
    const swung = Math.abs(sway.x);
    expect(swung).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) sway.update(FRAME, 0, 0);
    expect(Math.abs(sway.x)).toBeLessThan(swung);
    expect(Math.abs(sway.x)).toBeLessThan(1e-3);
    expect(Math.abs(sway.y)).toBeLessThan(1e-3);
  });

  it('never lags further than the config allows', () => {
    const sway = createMouseSway();
    for (let i = 0; i < 120; i++) sway.update(FRAME, 2, 2);
    expect(Math.abs(sway.x)).toBeLessThanOrEqual(CONFIG.FEEL.swayMax + 1e-9);
    expect(Math.abs(sway.y)).toBeLessThanOrEqual(CONFIG.FEEL.swayMax + 1e-9);
  });
});

describe('createCameraKick', () => {
  it('starts level', () => {
    const kick = createCameraKick();
    expect(kick.pitch).toBe(0);
    expect(kick.yaw).toBe(0);
  });

  it('adds up shot after shot', () => {
    const kick = createCameraKick();
    kick.addKick(0.01, 0.002);
    kick.addKick(0.01, 0.002);
    expect(kick.pitch).toBeCloseTo(0.02, 10);
    expect(kick.yaw).toBeCloseTo(0.004, 10);
  });

  it('recovers to exactly 0', () => {
    const kick = createCameraKick();
    kick.addKick(0.03, -0.02);
    for (let i = 0; i < 120; i++) kick.update(FRAME);
    expect(kick.pitch).toBe(0);
    expect(kick.yaw).toBe(0);
  });

  it('decays monotonically toward rest', () => {
    const kick = createCameraKick();
    kick.addKick(0.04, 0);
    let previous = kick.pitch;
    for (let i = 0; i < 30; i++) {
      kick.update(FRAME);
      expect(kick.pitch).toBeLessThanOrEqual(previous);
      previous = kick.pitch;
    }
  });

  it('caps how far a single frame can be kicked', () => {
    const kick = createCameraKick();
    kick.addKick(5, -5);
    expect(kick.pitch).toBe(CONFIG.FEEL.kickMax);
    expect(kick.yaw).toBe(-CONFIG.FEEL.kickMax);
  });
});

describe('landingDip', () => {
  it('is nothing on a step that is not a fall', () => {
    expect(landingDip(0)).toBe(0);
    expect(landingDip(-2)).toBe(0);
  });

  it('grows in proportion to the height fallen', () => {
    const one = landingDip(1);
    expect(one).toBeCloseTo(CONFIG.FEEL.landDipPerMeter, 10);
    expect(landingDip(2)).toBeCloseTo(2 * one, 10);
    expect(landingDip(0.5)).toBeCloseTo(one / 2, 10);
  });

  it('stops growing at the cap', () => {
    expect(landingDip(1000)).toBe(CONFIG.FEEL.landDipMax);
  });
});

describe('scopeFov', () => {
  it('reaches the scope fov within the transition time', () => {
    const target = CONFIG.WEAPONS.sniper.scopeFov;
    let fov = CONFIG.MAP.fov;
    let elapsed = 0;
    while (fov !== target && elapsed < 2) {
      fov = scopeFov(fov, target, FRAME);
      elapsed += FRAME;
    }
    expect(fov).toBe(target);
    expect(elapsed).toBeLessThanOrEqual(CONFIG.FEEL.scopeTransition + FRAME);
  });

  it('opens back out to the hip-fire fov just as fast', () => {
    const target = CONFIG.MAP.fov;
    let fov = CONFIG.WEAPONS.sniper.scopeFov;
    let elapsed = 0;
    while (fov !== target && elapsed < 2) {
      fov = scopeFov(fov, target, FRAME);
      elapsed += FRAME;
    }
    expect(fov).toBe(target);
    expect(elapsed).toBeLessThanOrEqual(CONFIG.FEEL.scopeTransition + FRAME);
  });

  it('moves toward the target and never past it', () => {
    const target = CONFIG.WEAPONS.sniper.scopeFov;
    let fov = CONFIG.MAP.fov;
    for (let i = 0; i < 10; i++) {
      const next = scopeFov(fov, target, FRAME);
      expect(next).toBeLessThanOrEqual(fov);
      expect(next).toBeGreaterThanOrEqual(target);
      fov = next;
    }
  });

  it('lands on the target when one frame would overshoot', () => {
    const target = CONFIG.WEAPONS.sniper.scopeFov;
    expect(scopeFov(target + 0.001, target, FRAME)).toBe(target);
    expect(scopeFov(target, target, FRAME)).toBe(target);
  });

  it('does not move at all for a zero frame', () => {
    expect(scopeFov(CONFIG.MAP.fov, CONFIG.WEAPONS.sniper.scopeFov, 0)).toBe(CONFIG.MAP.fov);
  });
});

describe('damageIndicatorAngle', () => {
  const player = { x: 2, y: 0, z: -3 };

  it('points straight ahead at 0', () => {
    expect(damageIndicatorAngle(player, 0, { x: 2, y: 0, z: -8 })).toBeCloseTo(0, 10);
  });

  it('puts a shot from the right at +PI/2', () => {
    expect(damageIndicatorAngle(player, 0, { x: 7, y: 0, z: -3 })).toBeCloseTo(Math.PI / 2, 10);
  });

  it('turns with the player', () => {
    // A quarter turn left (yaw +PI/2) looks down -X, so a shooter there is dead ahead
    // even though he sits to the player's left on the map.
    expect(damageIndicatorAngle(player, Math.PI / 2, { x: -3, y: 0, z: -3 })).toBeCloseTo(0, 10);
  });
});
