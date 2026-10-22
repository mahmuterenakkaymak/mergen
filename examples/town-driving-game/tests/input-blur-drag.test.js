import { describe, it, expect } from 'vitest';
import { createInputState, attachInput, takeOrbit } from '../src/input.js';

// Alt-tabbing away mid-drag never delivers a pointerup, so blur has to end the drag
// itself — Node's EventTarget reproduces that: no pointerup, only the blur.
const setup = () => {
  const target = new EventTarget();
  const state = createInputState();
  const detach = attachInput(target, state);
  const pointer = (type, clientX, clientY) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { clientX, clientY }));
  const blur = () => target.dispatchEvent(new Event('blur'));
  return { state, detach, pointer, blur };
};

describe('attachInput blur during a drag', () => {
  it('ends the drag so plain mouse movement no longer orbits the camera', () => {
    const { state, pointer, blur } = setup();
    pointer('pointerdown', 100, 100);
    blur();
    pointer('pointermove', 600, 400);
    expect(state.dragX).toBe(0);
    expect(state.dragY).toBe(0);
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
  });

  it('keeps orbiting from the new pointerdown after a blur, not from the old one', () => {
    const { state, pointer, blur } = setup();
    pointer('pointerdown', 100, 100);
    blur();
    pointer('pointerdown', 500, 500);
    pointer('pointermove', 540, 500);
    expect(takeOrbit(state).yaw).toBeCloseTo(-0.2, 12);
  });
});
