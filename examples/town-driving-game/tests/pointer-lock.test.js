import { describe, it, expect } from 'vitest';
import {
  createInputState, togglePointerLock, attachInput, takeOrbit,
} from '../src/input.js';

// Node's EventTarget/Event stand in for the browser, as in input-dom.test.js. There is
// no document under Node, so attachInput keeps P a pure state flip — the same mode the
// browser enters once the lock is granted, minus the cursor.
const keyEvent = (type, code, repeat = false) =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });
const pointerEvent = (type, props = {}) => Object.assign(new Event(type), props);

const setup = () => {
  const target = new EventTarget();
  const state = createInputState();
  const detach = attachInput(target, state);
  const key = (code, repeat) => target.dispatchEvent(keyEvent('keydown', code, repeat));
  const pointer = (type, props) => target.dispatchEvent(pointerEvent(type, props));
  return { state, detach, key, pointer };
};

describe('pointer lock state', () => {
  it('starts unlocked', () => {
    expect(createInputState().pointerLock).toBe(false);
  });

  it('flips on every toggle and reports the new mode', () => {
    const state = createInputState();
    expect(togglePointerLock(state)).toBe(true);
    expect(state.pointerLock).toBe(true);
    expect(togglePointerLock(state)).toBe(false);
    expect(state.pointerLock).toBe(false);
  });
});

describe('P toggles the lock', () => {
  it('locks on the first press and unlocks on the next', () => {
    const { state, key } = setup();
    key('KeyP');
    expect(state.pointerLock).toBe(true);
    key('KeyP');
    expect(state.pointerLock).toBe(false);
  });

  it('ignores the auto-repeat of a held P', () => {
    const { state, key } = setup();
    key('KeyP');
    key('KeyP', true);
    expect(state.pointerLock).toBe(true);
  });

  it('stops toggling once detached', () => {
    const { state, detach, key } = setup();
    detach();
    key('KeyP');
    expect(state.pointerLock).toBe(false);
  });
});

describe('mouse look while locked', () => {
  it('orbits by the movement deltas with no button held', () => {
    const { state, key, pointer } = setup();
    key('KeyP');
    pointer('pointermove', { movementX: 100, movementY: -20 });
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(-0.5, 12);
    expect(o.pitch).toBeCloseTo(-0.08, 12);
  });

  it('counts only the movement deltas, not the pinned cursor position', () => {
    const { state, key, pointer } = setup();
    key('KeyP');
    pointer('pointermove', { clientX: 900, clientY: 700, movementX: 0, movementY: 0 });
    const o = takeOrbit(state);
    expect(o.yaw).toBeCloseTo(0, 12);
    expect(o.pitch).toBeCloseTo(0, 12);
  });
});

describe('drag fallback once unlocked', () => {
  it('ignores bare movement again and orbits on held-button drag', () => {
    const { state, key, pointer } = setup();
    key('KeyP');
    key('KeyP');
    pointer('pointermove', { clientX: 400, clientY: 400, movementX: 300, movementY: 300 });
    expect(takeOrbit(state).yaw).toBeCloseTo(0, 12);
    pointer('pointerdown', { clientX: 0, clientY: 0 });
    pointer('pointermove', { clientX: 40, clientY: 0 });
    expect(takeOrbit(state).yaw).toBeCloseTo(-0.2, 12);
  });
});
