import { describe, it, expect } from 'vitest';
import {
  createInputState, attachInput, toControls, isPressed, takeOrbit, takeZoom,
} from '../src/input.js';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

// Node's EventTarget/Event stand in for the browser: no KeyboardEvent needed, the
// pure half of input.js only reads code/repeat/clientX/clientY/deltaY off the event.
const keyEvent = (type, code, repeat = false) =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });
const pointerEvent = (type, clientX, clientY) =>
  Object.assign(new Event(type, { cancelable: true }), { clientX, clientY });
const wheelEvent = (deltaY) =>
  Object.assign(new Event('wheel'), { deltaY });

const setup = () => {
  const target = new EventTarget();
  const state = createInputState();
  const detach = attachInput(target, state);
  const key = (code, repeat) => target.dispatchEvent(keyEvent('keydown', code, repeat));
  const up = (code) => target.dispatchEvent(keyEvent('keyup', code));
  const pointer = (type, x, y) => target.dispatchEvent(pointerEvent(type, x, y));
  const wheel = (d) => target.dispatchEvent(wheelEvent(d));
  const blur = () => target.dispatchEvent(new Event('blur'));
  return { target, state, detach, key, up, pointer, wheel, blur };
};

describe('attachInput keys', () => {
  it('holds a key while it is down and releases it on keyup', () => {
    const { state, key, up } = setup();
    key('KeyW');
    expect(toControls(state)).toEqual({ ...IDLE, throttle: 1 });
    up('KeyW');
    expect(toControls(state)).toEqual(IDLE);
  });

  it('feeds the edge-triggered presses the sim reads with isPressed', () => {
    const { state, key } = setup();
    key('KeyH');
    expect(isPressed(state, 'KeyH')).toBe(true);
  });

  it('ignores keys the game does not use', () => {
    const { state, key } = setup();
    key('KeyQ');
    expect([...state.keys]).toEqual([]);
    expect(toControls(state)).toEqual(IDLE);
  });

  it('blocks the page scroll for arrows and Space only', () => {
    const { target } = setup();
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      const e = keyEvent('keydown', code);
      target.dispatchEvent(e);
      expect(e.defaultPrevented, code).toBe(true);
    }
    for (const code of ['KeyW', 'KeyH', 'F1', 'Escape']) {
      const e = keyEvent('keydown', code);
      target.dispatchEvent(e);
      expect(e.defaultPrevented, code).toBe(false);
    }
  });
});

describe('attachInput drag', () => {
  it('orbits by the pointer motion while the button is held', () => {
    const { state, pointer } = setup();
    pointer('pointerdown', 200, 150);
    pointer('pointermove', 240, 140);
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(-0.2, 12);
    expect(o.pitch).toBeCloseTo(-0.04, 12);
  });

  it('ignores the pointer until a button goes down', () => {
    const { state, pointer } = setup();
    pointer('pointermove', 100, 100);
    pointer('pointermove', 400, 400);
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(0, 12);
    expect(o.pitch).toBeCloseTo(0, 12);
  });

  it('accumulates several moves into one frame and drains on takeOrbit', () => {
    const { state, pointer } = setup();
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 30, 10);
    pointer('pointermove', 70, 30);
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(-0.35, 12);
    expect(o.pitch).toBeCloseTo(0.12, 12);
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
  });

  it('stops orbiting once the button is released', () => {
    const { state, pointer } = setup();
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 50, 0);
    takeOrbit(state);
    pointer('pointerup', 50, 0);
    pointer('pointermove', 500, 300);
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
  });

  it('ends the drag on pointercancel too', () => {
    const { state, pointer } = setup();
    pointer('pointerdown', 0, 0);
    pointer('pointercancel', 0, 0);
    pointer('pointermove', 200, 200);
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
  });

  it('measures a new drag from where it starts, not from the last one', () => {
    const { state, pointer } = setup();
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 10, 10);
    takeOrbit(state);
    pointer('pointerup', 10, 10);
    pointer('pointerdown', 800, 600);
    pointer('pointermove', 810, 600);
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(-0.05, 12);
    expect(o.pitch).toBeCloseTo(0, 12);
  });
});

describe('attachInput wheel', () => {
  it('accumulates wheel deltas and drains them on takeZoom', () => {
    const { state, wheel } = setup();
    wheel(100);
    wheel(-40);
    expect(takeZoom(state)).toBeCloseTo(0.6, 12);
    expect(takeZoom(state)).toBe(0);
  });
});

describe('attachInput blur', () => {
  it('drops held keys on blur so nothing stays stuck', () => {
    const { state, key, blur } = setup();
    key('KeyW');
    key('KeyA');
    key('Space');
    blur();
    expect(toControls(state)).toEqual(IDLE);
    expect([...state.keys]).toEqual([]);
  });

  it('stays usable after a blur', () => {
    const { state, key, up, blur } = setup();
    key('KeyW');
    blur();
    key('KeyW');
    expect(toControls(state).throttle).toBe(1);
    up('KeyW');
    expect(toControls(state).throttle).toBe(0);
  });
});

describe('detach', () => {
  it('removes every listener', () => {
    const { state, detach, key, pointer, wheel, blur } = setup();
    detach();
    key('KeyW');
    key('ArrowUp');
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 300, 300);
    wheel(200);
    blur();
    expect(toControls(state)).toEqual(IDLE);
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
    expect(takeZoom(state)).toBe(0);
    expect([...state.keys]).toEqual([]);
  });

  it('is safe to call twice', () => {
    const { detach } = setup();
    detach();
    expect(() => detach()).not.toThrow();
  });
});
