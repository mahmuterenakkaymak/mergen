// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MENU } from '../src/config.js';
import { createInput } from '../src/input.js';

let input = null;

const open = () => {
  input = createInput(window);
  return input;
};

afterEach(() => {
  input?.destroy();
  input = null;
});

const key = (type, code, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { code, ...extra }));
const button = (type, which) => window.dispatchEvent(new MouseEvent(type, { button: which }));
const wheelBy = (deltaY) => window.dispatchEvent(new WheelEvent('wheel', { deltaY }));

// jsdom builds MouseEvent without movementX/movementY in its init dictionary.
const move = (x, y) => {
  const event = new MouseEvent('mousemove');
  Object.defineProperty(event, 'movementX', { value: x });
  Object.defineProperty(event, 'movementY', { value: y });
  window.dispatchEvent(event);
};

describe('keyboard', () => {
  it('tracks every mapped key down to its action', () => {
    const state = open();
    const cases = [
      ['KeyW', 'forward'],
      ['KeyS', 'back'],
      ['KeyA', 'left'],
      ['KeyD', 'right'],
      ['Space', 'jump'],
      ['KeyC', 'crouch'],
      ['ControlLeft', 'crouch'],
      ['ShiftLeft', 'walk'],
      ['KeyR', 'reload'],
      ['KeyM', 'mute'],
      ['Digit1', 'slot1'],
      ['Digit2', 'slot2'],
      ['Digit3', 'slot3'],
      ['Escape', 'pause'],
    ];

    for (const [code, action] of cases) {
      key('keydown', code);
      expect(state.snapshot()[action]).toBe(true);
      key('keyup', code);
      expect(state.snapshot()[action]).toBe(false);
    }
  });

  it('key down and up update the snapshot', () => {
    const state = open();
    expect(state.snapshot().forward).toBe(false);

    key('keydown', 'KeyW');
    expect(state.snapshot().forward).toBe(true);
    expect(state.snapshot().back).toBe(false);

    key('keyup', 'KeyW');
    expect(state.snapshot().forward).toBe(false);
  });

  it('keeps an action held while any of its keys is down', () => {
    const state = open();
    key('keydown', 'KeyC');
    key('keydown', 'ControlLeft');
    key('keyup', 'KeyC');
    expect(state.snapshot().crouch).toBe(true);

    key('keyup', 'ControlLeft');
    expect(state.snapshot().crouch).toBe(false);
  });

  it('reports a pressed edge for one frame only', () => {
    const state = open();
    key('keydown', 'KeyR');
    expect(state.snapshot().pressed.reload).toBe(true);

    state.endFrame();
    expect(state.snapshot().pressed.reload).toBe(false);
    expect(state.snapshot().reload).toBe(true);

    key('keyup', 'KeyR');
    state.endFrame();
    expect(state.snapshot().reload).toBe(false);
    expect(state.snapshot().pressed.reload).toBe(false);
  });

  it('ignores key auto-repeat and a keyup that was never pressed', () => {
    const state = open();
    key('keydown', 'KeyM');
    state.endFrame();
    key('keydown', 'KeyM', { repeat: true });
    expect(state.snapshot().mute).toBe(true);
    expect(state.snapshot().pressed.mute).toBe(false);

    key('keyup', 'KeyR');
    expect(state.snapshot().reload).toBe(false);
  });

  it('a tap inside one frame still reports the edge', () => {
    const state = open();
    key('keydown', 'Space');
    key('keyup', 'Space');
    const frame = state.snapshot();
    expect(frame.jump).toBe(false);
    expect(frame.pressed.jump).toBe(true);
  });
});

describe('mouse', () => {
  it('accumulates the mouse delta and scales it by sensitivity', () => {
    const state = open();
    expect(state.sensitivity).toBe(MENU.defaultSensitivity);

    move(10, 5);
    expect(state.snapshot().mouseX).toBeCloseTo(10);
    expect(state.snapshot().mouseY).toBeCloseTo(5);

    state.endFrame();
    expect(state.snapshot().mouseX).toBe(0);

    state.sensitivity = 2;
    move(10, 5);
    expect(state.snapshot().mouseX).toBeCloseTo(20);
    expect(state.snapshot().mouseY).toBeCloseTo(10);

    state.sensitivity = 0.5;
    move(10, 5);
    expect(state.snapshot().mouseX).toBeCloseTo(25, 6);
    expect(state.snapshot().mouseY).toBeCloseTo(12.5, 6);
  });

  it('sums several moves within one frame', () => {
    const state = open();
    state.sensitivity = 3;
    move(4, -2);
    move(-1, 6);
    const frame = state.snapshot();
    expect(frame.mouseX).toBeCloseTo(9);
    expect(frame.mouseY).toBeCloseTo(12);
  });

  it('rejects a non-positive sensitivity', () => {
    const state = open();
    state.sensitivity = 0;
    expect(state.sensitivity).toBe(MENU.defaultSensitivity);
    state.sensitivity = Number.NaN;
    expect(state.sensitivity).toBe(MENU.defaultSensitivity);
  });

  it('tracks the fire and aim buttons', () => {
    const state = open();
    button('mousedown', 0);
    expect(state.snapshot().fire).toBe(true);
    expect(state.snapshot().pressed.fire).toBe(true);

    button('mouseup', 0);
    state.endFrame();
    expect(state.snapshot().fire).toBe(false);
    expect(state.snapshot().pressed.fire).toBe(false);

    button('mousedown', 2);
    expect(state.snapshot().ads).toBe(true);
    expect(state.snapshot().fire).toBe(false);
  });

  it('counts wheel notches in both directions', () => {
    const state = open();
    wheelBy(120);
    wheelBy(60);
    expect(state.snapshot().wheel).toBe(2);

    wheelBy(-100);
    expect(state.snapshot().wheel).toBe(1);

    state.endFrame();
    expect(state.snapshot().wheel).toBe(0);
  });
});

describe('lifecycle', () => {
  it('clears held keys when the window loses focus', () => {
    const state = open();
    key('keydown', 'KeyW');
    window.dispatchEvent(new Event('blur'));
    expect(state.snapshot().forward).toBe(false);
  });

  it('stops listening after destroy', () => {
    const state = open();
    state.destroy();
    key('keydown', 'KeyW');
    move(10, 10);
    expect(state.snapshot().forward).toBe(false);
    expect(state.snapshot().mouseX).toBe(0);
  });

  it('accepts an element and still captures window-level events', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    input = createInput(canvas);
    key('keydown', 'KeyD');
    expect(input.snapshot().right).toBe(true);
    canvas.remove();
  });
});
