// T48: HUD polish — the pure state behind the polished readouts: the session TOP speed
// badge and the hint strip's fade-and-return timer. The speed number's tween is format.js's
// tweenNumber (covered by hud-format.test.js); main.js feeds the badge that same tweened
// number, so TOP never shows more than the player saw.
import { describe, it, expect } from 'vitest';
import { createTopSpeed, createHint } from '../src/hud/hud.js';
import { tweenNumber } from '../src/hud/format.js';

const DT = 1 / 60;
const stepFor = (obj, seconds, dt = DT) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) obj.step(dt);
};

describe('session top speed', () => {
  it('starts at zero, before the car has moved', () => {
    const top = createTopSpeed();
    expect(top.value).toBe(0);
    expect(top.record).toBe(false);
  });

  it('keeps the fastest readout and ignores slower ones', () => {
    const top = createTopSpeed();
    top.update(40, DT);
    top.update(25, DT);
    expect(top.value).toBe(40);
    top.update(60, DT);
    expect(top.value).toBe(60);
  });

  it('holds the badge lit while a new best lands, then settles', () => {
    const top = createTopSpeed();
    top.update(50, DT);
    expect(top.record).toBe(true);
    for (let i = 0; i < Math.round(1 / DT); i++) top.update(50, DT);
    expect(top.record).toBe(false);
    top.update(55, DT);
    expect(top.record).toBe(true);
  });
});

describe('hint strip timer', () => {
  it('stays up for the first 10 s, then hides', () => {
    const hint = createHint();
    expect(hint.visible).toBe(true);
    stepFor(hint, 9.9);
    expect(hint.visible).toBe(true);
    stepFor(hint, 0.3);
    expect(hint.visible).toBe(false);
  });

  it('F1 brings it back for another 10 s, then it fades again', () => {
    const hint = createHint();
    stepFor(hint, 11);
    expect(hint.visible).toBe(false);
    hint.show();
    expect(hint.visible).toBe(true);
    stepFor(hint, 9.9);
    expect(hint.visible).toBe(true);
    stepFor(hint, 0.3);
    expect(hint.visible).toBe(false);
  });

  it('re-showing early does not shorten the new stretch', () => {
    const hint = createHint();
    stepFor(hint, 4);
    hint.show();
    stepFor(hint, 9.9);
    expect(hint.visible).toBe(true);
  });
});

describe('the speed number the badge reads', () => {
  it('eases to a new speed instead of jumping to it', () => {
    expect(tweenNumber(0, 104, DT)).toBeLessThan(52);
    let v = 0;
    for (let i = 0; i < 120; i++) v = tweenNumber(v, 104, DT);
    expect(v).toBe(104);
  });
});
