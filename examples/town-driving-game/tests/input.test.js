import { describe, it, expect } from 'vitest';
import {
  createInputState, keyDown, keyUp, isPressed, endFrame, toControls,
  addDrag, takeOrbit, addWheel, takeZoom, clearAll,
} from '../src/input.js';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

const press = (state, code, opts = {}) => keyDown(state, { code, ...opts });
const release = (state, code) => keyUp(state, { code });

describe('createInputState', () => {
  it('starts with nothing held, no edges and no pending pointer motion', () => {
    const s = createInputState();
    expect([...s.keys]).toEqual([]);
    expect([...s.pressed]).toEqual([]);
    expect(s.dragX).toBe(0);
    expect(s.dragY).toBe(0);
    expect(s.wheel).toBe(0);
    expect(toControls(s)).toEqual(IDLE);
  });
});

describe('keyDown / keyUp', () => {
  it('tracks a held code and forgets it on key up', () => {
    const s = createInputState();
    press(s, 'KeyW');
    expect(s.keys.has('KeyW')).toBe(true);
    release(s, 'KeyW');
    expect(s.keys.has('KeyW')).toBe(false);
  });

  it('ignores codes the game does not use', () => {
    const s = createInputState();
    press(s, 'KeyQ');
    press(s, 'ControlLeft');
    expect([...s.keys]).toEqual([]);
    expect([...s.pressed]).toEqual([]);
  });

  it('tracks every named key', () => {
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft',
      'ArrowRight', 'Space', 'KeyH', 'KeyR', 'KeyP', 'Escape', 'F1'];
    const s = createInputState();
    for (const c of codes) press(s, c);
    for (const c of codes) expect(s.keys.has(c)).toBe(true);
    expect([...s.pressed].length).toBe(codes.length);
  });

  it('survives a key up that was never pressed and a repeated key up', () => {
    const s = createInputState();
    release(s, 'KeyW');
    expect(s.keys.has('KeyW')).toBe(false);
    press(s, 'KeyH');
    release(s, 'KeyH');
    release(s, 'KeyH');
    expect(isPressed(s, 'KeyH')).toBe(true);
  });
});

describe('pressed edges', () => {
  it('fires once per press, not while held', () => {
    const s = createInputState();
    press(s, 'KeyR');
    expect(isPressed(s, 'KeyR')).toBe(true);
    press(s, 'KeyR', { repeat: true });
    press(s, 'KeyR', { repeat: true });
    expect([...s.pressed].length).toBe(1);
    expect(s.keys.has('KeyR')).toBe(true);
  });

  it('is read-only, so two readers of the same key both see it', () => {
    const s = createInputState();
    press(s, 'KeyH');
    expect(isPressed(s, 'KeyH')).toBe(true);
    expect(isPressed(s, 'KeyH')).toBe(true);
  });

  it('is gone after endFrame but the key stays held', () => {
    const s = createInputState();
    press(s, 'KeyH');
    endFrame(s);
    expect(isPressed(s, 'KeyH')).toBe(false);
    expect(s.keys.has('KeyH')).toBe(true);
    expect(toControls(s)).toEqual(IDLE);
  });

  it('re-arms after a real release and press', () => {
    const s = createInputState();
    press(s, 'Escape');
    endFrame(s);
    expect(isPressed(s, 'Escape')).toBe(false);
    release(s, 'Escape');
    press(s, 'Escape');
    expect(isPressed(s, 'Escape')).toBe(true);
  });

  it('never fires on key up', () => {
    const s = createInputState();
    press(s, 'F1');
    endFrame(s);
    release(s, 'F1');
    expect(isPressed(s, 'F1')).toBe(false);
  });
});

describe('toControls', () => {
  it('maps W and ArrowUp to throttle, S and ArrowDown to brake', () => {
    const s = createInputState();
    press(s, 'KeyW');
    expect(toControls(s)).toEqual({ ...IDLE, throttle: 1 });
    release(s, 'KeyW');
    press(s, 'ArrowUp');
    expect(toControls(s)).toEqual({ ...IDLE, throttle: 1 });
    press(s, 'ArrowDown');
    expect(toControls(s)).toEqual({ ...IDLE, throttle: 1, brake: 1 });
  });

  it('steers positive for A/ArrowLeft and negative for D/ArrowRight', () => {
    const s = createInputState();
    press(s, 'KeyA');
    expect(toControls(s).steer).toBe(1);
    release(s, 'KeyA');
    press(s, 'ArrowLeft');
    expect(toControls(s).steer).toBe(1);
    release(s, 'ArrowLeft');
    press(s, 'KeyD');
    expect(toControls(s).steer).toBe(-1);
    release(s, 'KeyD');
    press(s, 'ArrowRight');
    expect(toControls(s).steer).toBe(-1);
  });

  it('mirrors left and right and cancels them when both are held', () => {
    const s = createInputState();
    press(s, 'KeyA');
    const left = toControls(s).steer;
    release(s, 'KeyA');
    press(s, 'KeyD');
    expect(toControls(s).steer).toBe(-left);
    press(s, 'KeyA');
    expect(toControls(s).steer).toBe(0);
  });

  it('maps Space to the handbrake and leaves the rest alone', () => {
    const s = createInputState();
    press(s, 'Space');
    expect(toControls(s)).toEqual({ ...IDLE, handbrake: 1 });
  });

  it('mixes throttle, brake, steer and handbrake at once', () => {
    const s = createInputState();
    for (const c of ['KeyW', 'ArrowDown', 'ArrowLeft', 'Space']) press(s, c);
    expect(toControls(s)).toEqual({ throttle: 1, brake: 1, steer: 1, handbrake: 1 });
  });

  it('keeps driving while an edge key is held', () => {
    const s = createInputState();
    press(s, 'KeyW');
    press(s, 'KeyH');
    expect(toControls(s)).toEqual({ ...IDLE, throttle: 1 });
  });

  it('returns a fresh plain object every call', () => {
    const s = createInputState();
    const a = toControls(s);
    const b = toControls(s);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('drag -> orbit', () => {
  it('turns yaw against horizontal drag and pitch with vertical drag', () => {
    const s = createInputState();
    addDrag(s, 100, 50);
    const o = takeOrbit(s);
    expect(o.yaw).toBeCloseTo(-0.5, 12);
    expect(o.pitch).toBeCloseTo(0.2, 12);
  });

  it('accumulates several moves within one frame', () => {
    const s = createInputState();
    addDrag(s, 40, -10);
    addDrag(s, 60, -20);
    const o = takeOrbit(s);
    expect(o.yaw).toBeCloseTo(-0.5, 12);
    expect(o.pitch).toBeCloseTo(-0.12, 12);
  });

  it('drains after takeOrbit so a still mouse does not keep orbiting', () => {
    const s = createInputState();
    addDrag(s, 100, 100);
    takeOrbit(s);
    const still = takeOrbit(s);
    expect(still.yaw).toBeCloseTo(0, 12);
    expect(still.pitch).toBeCloseTo(0, 12);
    expect(s.dragX).toBe(0);
    expect(s.dragY).toBe(0);
  });

  it('gives zero orbit with no drag', () => {
    const o = takeOrbit(createInputState());
    expect(o.yaw).toBeCloseTo(0, 12);
    expect(o.pitch).toBeCloseTo(0, 12);
  });
});

describe('wheel -> zoom', () => {
  it('scales the wheel delta and drains it', () => {
    const s = createInputState();
    addWheel(s, 100);
    expect(takeZoom(s)).toBeCloseTo(1, 12);
    expect(takeZoom(s)).toBe(0);
  });

  it('accumulates and keeps its sign (down scrolls out)', () => {
    const s = createInputState();
    addWheel(s, -53);
    addWheel(s, -53);
    expect(takeZoom(s)).toBeCloseTo(-1.06, 12);
  });
});

describe('clearAll', () => {
  it('drops held keys, edges and pending pointer motion', () => {
    const s = createInputState();
    for (const c of ['KeyW', 'KeyA', 'Space', 'KeyH']) press(s, c);
    addDrag(s, 30, 40);
    addWheel(s, 90);
    clearAll(s);
    expect(toControls(s)).toEqual(IDLE);
    expect([...s.keys]).toEqual([]);
    expect([...s.pressed]).toEqual([]);
    const o = takeOrbit(s);
    expect(o.yaw).toBeCloseTo(0, 12);
    expect(o.pitch).toBeCloseTo(0, 12);
    expect(takeZoom(s)).toBe(0);
  });

  it('leaves the state usable afterwards', () => {
    const s = createInputState();
    press(s, 'KeyW');
    clearAll(s);
    press(s, 'KeyW');
    expect(toControls(s).throttle).toBe(1);
    expect(isPressed(s, 'KeyW')).toBe(true);
  });
});
