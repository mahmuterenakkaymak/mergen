// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createFpsMeter } from '../src/core/fps.js';
import { createHud } from '../src/ui/hud.js';

const VIEW = {
  health: 87,
  weaponName: 'Rifle',
  mag: 24,
  reserve: 90,
  score: { player: 2, bots: 1 },
  roundTime: 72,
  fps: 143.6,
  crosshairRadius: 6,
  scoped: false,
  reloading: false,
  reloadProgress: 0,
};

describe('createFpsMeter', () => {
  it('seeds the first sample instead of ramping up from zero', () => {
    const meter = createFpsMeter();
    expect(meter.sample(1 / 60)).toBeCloseTo(60, 6);
    expect(meter.fps).toBeCloseTo(60, 6);
  });

  it('smooths toward a new rate and converges on it', () => {
    const meter = createFpsMeter(0.9);
    meter.sample(1 / 60);
    const after = meter.sample(1 / 30);
    expect(after).toBeLessThan(60);
    expect(after).toBeGreaterThan(30);

    for (let i = 0; i < 200; i++) meter.sample(1 / 30);
    expect(meter.fps).toBeCloseTo(30, 1);
  });

  it('tracks the frame exactly at smoothing 0', () => {
    const meter = createFpsMeter(0);
    expect(meter.sample(1 / 144)).toBeCloseTo(144, 6);
    expect(meter.sample(1 / 24)).toBeCloseTo(24, 6);
  });

  it('ignores non-positive deltas and resets to zero', () => {
    const meter = createFpsMeter();
    meter.sample(1 / 60);
    const before = meter.fps;
    expect(meter.sample(0)).toBeCloseTo(before, 6);
    expect(meter.sample(-0.016)).toBeCloseTo(before, 6);
    meter.reset();
    expect(meter.fps).toBe(0);
  });
});

describe('createHud', () => {
  let root;
  let hud;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    hud = createHud(root);
  });

  afterEach(() => {
    hud.hideHitmarker();
    hud.el.remove();
    root.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('mounts in the given root and survives an update with no view', () => {
    expect(root.contains(hud.el)).toBe(true);
    expect(() => hud.update()).not.toThrow();
  });

  it('reflects the view in health, ammo, weapon, score, timer and fps', () => {
    hud.update(VIEW);
    const { els } = hud;
    expect(els.health.textContent).toBe('87');
    expect(els.mag.textContent).toBe('24');
    expect(els.reserve.textContent).toBe('90');
    expect(els.weapon.textContent).toBe('Rifle');
    expect(els.scorePlayer.textContent).toBe('2');
    expect(els.scoreBots.textContent).toBe('1');
    expect(els.timer.textContent).toBe('1:12');
    expect(els.fps.textContent).toBe('144');
  });

  it('formats the round timer as m:ss', () => {
    const cases = [
      [0, '0:00'],
      [9.4, '0:09'],
      [65, '1:05'],
      [600, '10:00'],
      [-3, '0:00'],
    ];
    for (const [seconds, expected] of cases) {
      hud.update({ roundTime: seconds });
      expect(hud.els.timer.textContent).toBe(expected);
    }
  });

  it('leaves a readout alone when the view omits it', () => {
    hud.update(VIEW);
    hud.update({ health: 41 });
    expect(hud.els.health.textContent).toBe('41');
    expect(hud.els.weapon.textContent).toBe('Rifle');
    expect(hud.els.reserve.textContent).toBe('90');
  });

  it('shows the FPS readout as a positive number', () => {
    const meter = createFpsMeter();
    for (let i = 0; i < 10; i++) meter.sample(1 / 144);

    hud.update({ fps: meter.fps });

    const shown = Number.parseFloat(hud.els.fps.textContent);
    expect(Number.isFinite(shown)).toBe(true);
    expect(shown).toBeGreaterThan(0);
  });

  it('builds a 4-line crosshair whose gap equals the radius', () => {
    hud.update({ crosshairRadius: 14 });
    const len = CONFIG.HUD.crosshairLength;
    const lines = hud.els.crosshairLines;

    expect(hud.els.crosshair.children).toHaveLength(4);
    expect(lines.right.style.left).toBe('14px');
    expect(lines.bottom.style.top).toBe('14px');
    expect(lines.left.style.left).toBe(`${-(14 * CONFIG.HUD.crosshairGapScale + len)}px`);
    expect(lines.top.style.top).toBe(`${-(14 * CONFIG.HUD.crosshairGapScale + len)}px`);
  });

  it('opens the crosshair gap as the radius grows', () => {
    hud.update({ crosshairRadius: 3 });
    const small = Number.parseFloat(hud.els.crosshairLines.right.style.left);
    hud.update({ crosshairRadius: 22 });
    const big = Number.parseFloat(hud.els.crosshairLines.right.style.left);
    expect(big).toBeGreaterThan(small);
  });

  it('shows the hitmarker on a hit and hides it after CONFIG.HUD.hitmarkerTime', () => {
    expect(hud.els.hitmarker.hidden).toBe(true);

    hud.showHitmarker();
    expect(hud.els.hitmarker.hidden).toBe(false);

    vi.advanceTimersByTime(CONFIG.HUD.hitmarkerTime * 1000 - 1);
    expect(hud.els.hitmarker.hidden).toBe(false);

    vi.advanceTimersByTime(2);
    expect(hud.els.hitmarker.hidden).toBe(true);
  });

  it('hides the hitmarker early on a fresh hit and never stacks timers', () => {
    hud.showHitmarker();
    vi.advanceTimersByTime(CONFIG.HUD.hitmarkerTime * 1000 - 1);
    hud.showHitmarker();
    vi.advanceTimersByTime(CONFIG.HUD.hitmarkerTime * 1000 - 1);
    expect(hud.els.hitmarker.hidden).toBe(false);

    vi.advanceTimersByTime(2);
    expect(hud.els.hitmarker.hidden).toBe(true);
  });

  it('marks a headshot in red', () => {
    hud.showHitmarker();
    const bodyColor = hud.els.hitmarker.firstElementChild.style.backgroundColor;
    expect(hud.els.hitmarker.dataset.headshot).toBeUndefined();

    hud.showHitmarker({ headshot: true });
    const headColor = hud.els.hitmarker.firstElementChild.style.backgroundColor;
    expect(hud.els.hitmarker.dataset.headshot).toBe('1');
    expect(headColor).not.toBe(bodyColor);
    expect(headColor).toMatch(/rgb\(255,\s*(?:[0-9]|[0-9][0-9]),\s*(?:[0-9]|[0-9][0-9])\)|#ff/i);
  });

  it('shows the scope overlay only while scoped, hiding the crosshair with it', () => {
    expect(hud.els.scope.hidden).toBe(true);
    expect(hud.els.crosshair.hidden).toBe(false);

    hud.update({ scoped: true });
    expect(hud.els.scope.hidden).toBe(false);
    expect(hud.els.crosshair.hidden).toBe(true);

    hud.update({ scoped: false });
    expect(hud.els.scope.hidden).toBe(true);
    expect(hud.els.crosshair.hidden).toBe(false);
  });

  it('shows reload progress only while reloading', () => {
    expect(hud.els.reload.hidden).toBe(true);

    hud.update({ reloading: true, reloadProgress: 0.4 });
    expect(hud.els.reload.hidden).toBe(false);
    expect(hud.els.reloadFill.style.width).toBe('40%');

    hud.update({ reloading: true, reloadProgress: 1 });
    expect(hud.els.reloadFill.style.width).toBe('100%');

    hud.update({ reloading: false });
    expect(hud.els.reload.hidden).toBe(true);
  });
});
