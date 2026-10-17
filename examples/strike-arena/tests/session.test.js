// @vitest-environment jsdom
// The wiring, where the menus, the pointer lock, the mute key and the fixed loop meet. The
// collaborators are the real ones — real input, real menu, real world stepped through the
// real fixed loop — and only the two things a headless test cannot have are faked: an
// AudioContext, and a browser that hands out pointer lock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA from '../src/core/mapData.js';
import { createWorld } from '../src/core/game.js';
import { createFixedLoop } from '../src/core/loop.js';
import { createInput } from '../src/input.js';
import { createMenu } from '../src/ui/menu.js';
import { createSession } from '../src/session.js';

const DT = CONFIG.LOOP.step;

// input.js reads event.code off whatever it is handed; bolting the code onto a plain Event
// keeps the test independent of how much of KeyboardEventInit this jsdom implements.
function press(code) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  window.dispatchEvent(event);
}

function release(code) {
  const event = new Event('keyup', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  window.dispatchEvent(event);
}

function tap(code) {
  press(code);
  release(code);
}

// A pointer lock that can be refused, held and taken back, which is all of the behaviour
// session.js actually branches on.
function fakePointerLock(canvas) {
  const lock = { locked: false, refused: false, requests: 0 };
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => (lock.locked ? canvas : null),
  });
  document.exitPointerLock = () => {
    lock.locked = false;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  canvas.requestPointerLock = () => {
    lock.requests += 1;
    if (!lock.refused) lock.locked = true;
  };
  return lock;
}

function fakeAudio() {
  const audio = {
    unlocks: 0,
    events: [],
    listeners: [],
    muted: false,
    unlock() {
      audio.unlocks += 1;
    },
    setListener(pos, yaw) {
      audio.listeners.push({ pos, yaw });
      return true;
    },
    toggleMute() {
      audio.muted = !audio.muted;
      return audio.muted;
    },
    handleEvents(events) {
      audio.events.push(...events);
    },
  };
  return audio;
}

function fakeEffects() {
  const fx = {
    events: [],
    handleEvents(events) {
      fx.events.push(...events);
    },
  };
  return fx;
}

let ctx = null;

// The same composition main.js does, minus the renderer: the menu's callbacks reach the
// session through a forward reference, exactly as they do in the browser.
function setup() {
  document.body.innerHTML = '<div id="menu"></div>';
  const canvas = document.createElement('canvas');
  const lock = fakePointerLock(canvas);
  const world = createWorld(CONFIG, MAP_DATA, 7);
  const input = createInput(window);
  const loop = createFixedLoop();
  const audio = fakeAudio();
  const effects = fakeEffects();
  const menu = createMenu(document.getElementById('menu'), {
    onStart: () => session.start(),
    onResume: () => session.resume(),
    onSensitivity: (value) => session.setSensitivity(value),
  });
  const session = createSession({ world, input, loop, menu, audio, effects, lockTarget: canvas });
  ctx = { world, input, loop, menu, audio, effects, session, canvas, lock };
  return ctx;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (!ctx) return;
  ctx.session.destroy();
  ctx.input.destroy();
  ctx = null;
  document.body.innerHTML = '';
});

describe('the start screen', () => {
  it('holds the world still until Start', () => {
    const { session, world, audio, menu } = setup();

    expect(session.paused).toBe(true);
    expect(menu.startVisible).toBe(true);
    expect(session.step(1)).toEqual([]);

    expect(world.time).toBe(0);
    expect(audio.unlocks).toBe(0);
  });

  it('drops the frame-scoped input it did not step with', () => {
    const { session, input } = setup();
    const endFrame = vi.spyOn(input, 'endFrame');

    session.step(DT);

    // Nothing stepped, so nothing else will clear the mouse delta: a mouse dragged across
    // the menu would otherwise resume as one enormous look jump.
    expect(endFrame).toHaveBeenCalled();
  });

  it('Start unlocks the audio, takes the lock and lets the world run', () => {
    const { session, world, audio, menu, lock } = setup();

    session.start();

    expect(audio.unlocks).toBe(1);
    expect(menu.startVisible).toBe(false);
    expect(lock.locked).toBe(true);

    session.step(DT);
    expect(world.time).toBeCloseTo(DT, 10);
  });
});

describe('the pause', () => {
  it('pauses on Esc, hands the mouse back and shows the menu', () => {
    const { session, world, menu, lock } = setup();
    session.start();
    session.step(DT);
    const t = world.time;

    tap('Escape');
    expect(session.step(DT)).toEqual([]);

    expect(session.paused).toBe(true);
    expect(menu.pauseVisible).toBe(true);
    expect(lock.locked).toBe(false);
    expect(world.time).toBe(t);
  });

  it('resumes on Esc, re-taking the lock and re-unlocking the audio', () => {
    const { session, audio, menu, lock } = setup();
    session.start();
    tap('Escape');
    session.step(DT);
    const unlocks = audio.unlocks;

    tap('Escape');
    session.step(DT);

    expect(session.paused).toBe(false);
    expect(menu.pauseVisible).toBe(false);
    expect(lock.locked).toBe(true);
    expect(audio.unlocks).toBe(unlocks + 1);
  });

  it('takes one Esc press as one pause, however many frames it spans', () => {
    const { session } = setup();
    session.start();

    tap('Escape');
    // A frame that owes no step never calls input.endFrame(), so the edge is still there on
    // the next one — and must not toggle the pause straight back off.
    session.step(0);
    expect(session.paused).toBe(true);
    session.step(0);
    session.step(0);
    expect(session.paused).toBe(true);
  });

  it('pauses when the browser takes the pointer lock back', () => {
    const { session, menu, lock } = setup();
    session.start();
    expect(lock.locked).toBe(true);

    lock.locked = false; // alt-tab, or the browser's own Esc
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(session.paused).toBe(true);
    expect(menu.pauseVisible).toBe(true);
  });

  it('pauses when the window loses focus', () => {
    const { session, menu } = setup();
    session.start();

    window.dispatchEvent(new Event('blur'));

    expect(session.paused).toBe(true);
    expect(menu.pauseVisible).toBe(true);
  });

  it('re-arms the lock on a canvas click, but never behind the menu', () => {
    const { session, canvas, lock } = setup();
    lock.refused = true; // a browser still honouring a recent denial
    session.start();
    expect(session.paused).toBe(false);
    expect(lock.locked).toBe(false);

    lock.refused = false; // the denial has aged out; the click is the gesture it wanted
    canvas.dispatchEvent(new Event('click'));
    expect(lock.locked).toBe(true);

    session.pause();
    const requests = lock.requests;
    canvas.dispatchEvent(new Event('click'));
    expect(lock.requests).toBe(requests);
  });

  it('freezes the fixed loop: no catch-up burst for the time spent in the menu', () => {
    const { session, world } = setup();
    session.start();
    session.step(DT);
    const t = world.time;

    session.pause();
    for (let i = 0; i < 60; i++) session.step(0.5); // 30 s of wall clock behind the overlay
    expect(world.time).toBe(t);

    session.resume();
    session.step(DT);
    expect(world.time).toBeCloseTo(t + DT, 10);
  });
});

describe('the settings', () => {
  it('M mutes and lights the mute indicator, and again brings the sound back', () => {
    const { session, audio, menu } = setup();
    session.start();

    tap('KeyM');
    session.step(DT);
    expect(audio.muted).toBe(true);
    expect(menu.muted).toBe(true);
    expect(menu.els.muteIndicator.hidden).toBe(false);

    tap('KeyM');
    session.step(DT);
    expect(audio.muted).toBe(false);
    expect(menu.els.muteIndicator.hidden).toBe(true);
  });

  it('runs the slider straight into the input and into localStorage', () => {
    const { session, input, menu } = setup();

    const slider = menu.els.sliders[0];
    slider.value = '2.5';
    slider.dispatchEvent(new Event('input'));

    expect(input.sensitivity).toBe(2.5);
    expect(localStorage.getItem(CONFIG.MENU.storageKey)).toBe('2.5');

    // And a menu built later — a reload — hands the stored value back to the input.
    const again = createMenu(document.createElement('div'), {});
    expect(session.setSensitivity(again.sensitivity)).toBe(2.5);
  });
});

describe('the event fan-out', () => {
  it('gives every tick event to the audio and to the effects, and back to the caller', () => {
    const { session, audio, effects } = setup();
    session.start();
    press('KeyW'); // walk until the first footfalls

    const returned = [];
    for (let i = 0; i < 120 && returned.length === 0; i++) returned.push(...session.step(DT));

    expect(returned.length).toBeGreaterThan(0);
    expect(audio.events).toEqual(returned);
    expect(effects.events).toEqual(returned);
  });

  it('gives nothing out while paused', () => {
    const { session, audio, effects } = setup();
    session.start();
    session.pause();

    for (let i = 0; i < 10; i++) expect(session.step(DT)).toEqual([]);

    expect(audio.events).toEqual([]);
    expect(effects.events).toEqual([]);
  });
});

describe('the audio listener', () => {
  it('carries the ear on the player, and leaves it alone behind the menu', () => {
    const { session, world, audio } = setup();
    session.start();
    session.step(DT);

    // A bot's shot is a PannerNode at the bot, so it is the listener that decides which ear
    // hears it: parked at the origin, every firefight sounds like it is at the map centre.
    expect(audio.listeners.length).toBeGreaterThan(0);
    const { pos, yaw } = audio.listeners.at(-1);
    const box = world.player.box;
    expect(pos.x).toBeCloseTo((box.min.x + box.max.x) / 2, 10);
    expect(pos.y).toBeCloseTo(box.min.y + world.player.eyeY, 10);
    expect(pos.z).toBeCloseTo((box.min.z + box.max.z) / 2, 10);
    expect(yaw).toBe(world.player.yaw);

    session.pause();
    const heard = audio.listeners.length;
    for (let i = 0; i < 5; i++) session.step(DT);
    expect(audio.listeners.length).toBe(heard);
  });
});
