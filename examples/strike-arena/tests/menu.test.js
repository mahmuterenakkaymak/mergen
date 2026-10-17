// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createMenu } from '../src/ui/menu.js';

const MENU = CONFIG.MENU;
const KEY = MENU.storageKey;

let root;

const build = (handlers) => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  return createMenu(node, handlers);
};

// jsdom never fires input/change on its own when a script sets .value, so a drag is
// "assign, then dispatch" — the same pair a real thumb produces.
const drag = (slider, value) => {
  slider.value = String(value);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('start screen', () => {
  it('shows a title, a Start button, a sensitivity slider and the key help', () => {
    const menu = createMenu(root);
    const { els } = menu;

    expect(menu.startVisible).toBe(true);
    expect(els.title.textContent).toMatch(/STRIKE ARENA/i);
    expect(els.startButton).toBeTruthy();
    expect(els.sliders).toHaveLength(2); // start + pause
    expect(els.sliders[0].type).toBe('range');
    expect(Number(els.sliders[0].min)).toBe(MENU.minSensitivity);
    expect(Number(els.sliders[0].max)).toBe(MENU.maxSensitivity);

    const help = els.helpPanels[0].textContent;
    for (const key of ['WASD', 'Esc', 'M', 'R']) expect(help).toContain(key);
  });

  it('starts at the default sensitivity and writes nothing to storage before the player touches it', () => {
    const menu = createMenu(root);
    expect(menu.sensitivity).toBe(MENU.defaultSensitivity);
    expect(menu.els.sensValues[0].textContent).toContain(MENU.defaultSensitivity.toFixed(2));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('sensitivity slider', () => {
  it('calls onSensitivity with the new factor and persists it under the CONFIG key', () => {
    const onSensitivity = vi.fn();
    const menu = createMenu(root, { onSensitivity });

    drag(menu.els.sliders[0], 1.75);

    expect(onSensitivity).toHaveBeenCalledTimes(1);
    expect(onSensitivity).toHaveBeenCalledWith(1.75);
    expect(menu.sensitivity).toBe(1.75);
    expect(localStorage.getItem(KEY)).toBe('1.75');
  });

  it('shows the live value next to the slider', () => {
    const menu = createMenu(root);
    drag(menu.els.sliders[0], 2.4);
    expect(menu.els.sensValues[0].textContent).toContain('2.40');
  });

  it('keeps the start and pause sliders on one setting, reporting the change once', () => {
    const onSensitivity = vi.fn();
    const menu = createMenu(root, { onSensitivity });

    drag(menu.els.sliders[1], 0.6);

    expect(onSensitivity).toHaveBeenCalledTimes(1); // input + change on one thumb -> one report
    expect(Number(menu.els.sliders[0].value)).toBeCloseTo(0.6, 5);
    expect(menu.els.sensValues[0].textContent).toContain('0.60');
  });

  it('clamps to the configured range instead of storing an unusable factor', () => {
    const onSensitivity = vi.fn();
    const menu = createMenu(root, { onSensitivity });

    drag(menu.els.sliders[0], MENU.maxSensitivity + 10);
    expect(menu.sensitivity).toBe(MENU.maxSensitivity);
    expect(onSensitivity).toHaveBeenLastCalledWith(MENU.maxSensitivity);

    drag(menu.els.sliders[0], MENU.minSensitivity / 2);
    expect(menu.sensitivity).toBe(MENU.minSensitivity);
    expect(localStorage.getItem(KEY)).toBe(String(MENU.minSensitivity));
  });

  it('leaves the callback alone when the slider lands back on the value it already had', () => {
    const onSensitivity = vi.fn();
    const menu = createMenu(root, { onSensitivity });

    drag(menu.els.sliders[0], 1.5);
    drag(menu.els.sliders[0], 1.5);

    expect(onSensitivity).toHaveBeenCalledTimes(1);
  });
});

describe('sensitivity persistence', () => {
  it('restores the stored factor when the menu is created again', () => {
    const first = createMenu(root);
    drag(first.els.sliders[0], 2.4);

    const reloaded = build();
    expect(reloaded.sensitivity).toBe(2.4);
    expect(Number(reloaded.els.sliders[0].value)).toBeCloseTo(2.4, 5);
    expect(reloaded.els.sensValues[0].textContent).toContain('2.40');
  });

  it('restores a stored factor without calling onSensitivity — the getter is the startup read', () => {
    localStorage.setItem(KEY, '1.3');
    const onSensitivity = vi.fn();
    const menu = build({ onSensitivity });

    expect(menu.sensitivity).toBe(1.3);
    expect(onSensitivity).not.toHaveBeenCalled();
  });

  it('falls back to the default when storage holds junk or an out-of-range value', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(build().sensitivity).toBe(MENU.defaultSensitivity);

    localStorage.setItem(KEY, String(MENU.maxSensitivity * 5));
    expect(build().sensitivity).toBe(MENU.maxSensitivity);
  });
});

describe('Start and pause overlays', () => {
  it('hides the start overlay and calls onStart when Start is clicked', () => {
    const onStart = vi.fn();
    const menu = createMenu(root, { onStart });

    menu.els.startButton.click();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.startVisible).toBe(false);
    expect(menu.pauseVisible).toBe(false);
  });

  it('shows and hides the pause overlay without touching the start screen', () => {
    const menu = createMenu(root);
    menu.hideStart();

    menu.showPause();
    expect(menu.pauseVisible).toBe(true);
    expect(menu.startVisible).toBe(false);

    menu.hidePause();
    expect(menu.pauseVisible).toBe(false);
  });

  it('drops the pause overlay and calls onResume when Resume is clicked', () => {
    const onResume = vi.fn();
    const menu = createMenu(root, { onResume });

    menu.showPause();
    menu.els.resumeButton.click();

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(menu.pauseVisible).toBe(false);
  });

  it('keeps its panels clickable while the layer itself stays click-through', () => {
    const menu = createMenu(root);
    expect(menu.el.style.pointerEvents).not.toBe('auto');
    expect(menu.els.startPanel.style.pointerEvents).toBe('auto');
    expect(menu.els.pausePanel.style.pointerEvents).toBe('auto');
  });
});

describe('mute indicator', () => {
  it('is down by default and shows only while muted', () => {
    const menu = createMenu(root);
    expect(menu.muted).toBe(false);
    expect(menu.els.muteIndicator.hidden).toBe(true);

    expect(menu.setMuted(true)).toBe(true);
    expect(menu.els.muteIndicator.textContent).toMatch(/MUTED/i);
    expect(menu.els.muteIndicator.hidden).toBe(false);

    menu.setMuted(false);
    expect(menu.els.muteIndicator.hidden).toBe(true);
  });
});
