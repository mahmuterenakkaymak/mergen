import { describe, it, expect } from 'vitest';
import { createToastQueue, createHud } from '../src/hud/hud.js';

const DT = 1 / 60;
const step = (q, seconds, dt = DT) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) q.step(dt);
};

describe('toast queue', () => {
  it('shows a message immediately', () => {
    const q = createToastQueue(2);
    q.show('GO!');
    expect(q.visible).toBe(true);
    expect(q.text).toBe('GO!');
  });

  it('hides after N seconds and stays hidden', () => {
    const q = createToastQueue(2);
    q.show('GO!');
    step(q, 1.9);
    expect(q.visible).toBe(true);
    step(q, 0.2);
    expect(q.visible).toBe(false);
    step(q, 1);
    expect(q.visible).toBe(false);
  });

  it('defaults to the prototype 1.6 s lifetime', () => {
    const q = createToastQueue();
    q.show('WATCH OUT!');
    step(q, 1.5);
    expect(q.visible).toBe(true);
    step(q, 0.2);
    expect(q.visible).toBe(false);
  });

  it('plays a queued message after the current one expires', () => {
    const q = createToastQueue(2);
    q.show('A');
    q.show('B');
    expect(q.text).toBe('A');
    step(q, 2.05);
    expect(q.text).toBe('B');
    expect(q.visible).toBe(true);
    step(q, 2.05);
    expect(q.visible).toBe(false);
  });

  it('does not cut the current message short when a new one arrives', () => {
    const q = createToastQueue(2);
    q.show('A');
    step(q, 1.5);
    q.show('B');
    expect(q.text).toBe('A');
    step(q, 0.6);
    expect(q.text).toBe('B');
  });

  it('drains the queue in order', () => {
    const q = createToastQueue(1);
    q.show('A');
    q.show('B');
    q.show('C');
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push(q.text);
      step(q, 1.05);
    }
    expect(seen).toEqual(['A', 'B', 'C']);
    expect(q.visible).toBe(false);
  });

  it('is a no-op when stepped empty', () => {
    const q = createToastQueue(2);
    expect(() => q.step(0.1)).not.toThrow();
    expect(q.visible).toBe(false);
    expect(q.text).toBe(null);
  });
});

describe('createHud', () => {
  it('is exported as a function (DOM builder, exercised in the browser)', () => {
    expect(typeof createHud).toBe('function');
  });
});
