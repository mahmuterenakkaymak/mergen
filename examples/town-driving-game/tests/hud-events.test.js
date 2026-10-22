import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createVignette, eventsToHud, createHud } from '../src/hud/hud.js';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

// Minimal DOM stand-in: createHud only sets id/className/textContent and uses .append().
function fakeDoc() {
  const items = [];
  const make = () => ({
    id: '', className: '', textContent: '', innerHTML: '', style: {}, children: [],
    append(...els) { this.children.push(...els); },
  });
  return { body: { appendChild: (el) => items.push(el) }, createElement: make, items };
}
const find = (el, id) =>
  el.id === id ? el : el.children.map((c) => find(c, id)).find(Boolean) ?? null;

describe('eventsToHud', () => {
  it('maps an impact to a vignette flash', () => {
    const h = eventsToHud([{ type: 'impact', speed: 16 }], 0);
    expect(h.vignette).toBeGreaterThan(0);
    expect(h.toasts).toEqual([]);
  });

  it('ignores bumps at or below the damage floor', () => {
    expect(eventsToHud([{ type: 'impact', speed: 6 }], 0).vignette).toBe(0);
  });

  it('uses a thud event\'s own flash and overheating flag', () => {
    const h = eventsToHud([{ type: 'thud', speed: 12, vignette: 0.2, overheat: true }], 0);
    expect(h.vignette).toBe(0.2);
    expect(h.toasts).toEqual(['ENGINE OVERHEATING — R TO REPAIR']);
  });

  it('maps reset to a toast', () => {
    expect(eventsToHud([{ type: 'reset' }], 0).toasts).toEqual(['RESET — REPAIRED']);
  });

  it('toasts watchOut at most once per 3 s', () => {
    let last = eventsToHud([{ type: 'watchOut' }], 0).lastWatchOut;
    expect(eventsToHud([{ type: 'watchOut' }], 2.9, last).toasts).toEqual([]);
    const h = eventsToHud([{ type: 'watchOut' }], 3.1, last);
    expect(h.toasts).toEqual(['WATCH OUT!']);
    expect(h.lastWatchOut).toBe(3.1);
  });

  it('collapses several watchOut events of one frame into one toast', () => {
    const h = eventsToHud([{ type: 'watchOut' }, { type: 'watchOut' }], 0);
    expect(h.toasts).toEqual(['WATCH OUT!']);
  });

  it('passes unrelated events through empty', () => {
    const h = eventsToHud([{ type: 'horn' }, { type: 'skid' }], 0);
    expect(h).toEqual({ vignette: 0, toasts: [], lastWatchOut: -Infinity });
  });
});

describe('createVignette', () => {
  it('flashes and caps at 1', () => {
    const v = createVignette();
    v.flash(0.7);
    v.flash(0.7);
    expect(v.amount).toBe(1);
  });

  it('decays to zero and never goes negative', () => {
    const v = createVignette();
    v.flash(0.5);
    for (let i = 0; i < 200; i++) v.step(1 / 60);
    expect(v.amount).toBe(0);
    v.step(1);
    expect(v.amount).toBe(0);
  });
});

describe('createHud damage bar + red vignette', () => {
  it('builds a damage bar whose fill width tracks setDamage', () => {
    const doc = fakeDoc();
    const hud = createHud(doc);
    const bar = doc.items.map((el) => find(el, 'dmgFill')).find(Boolean);
    hud.setDamage(42.4);
    expect(bar.style.width).toBe('42%');
    hud.setDamage(150);
    expect(bar.style.width).toBe('100%');
    hud.setDamage(-5);
    expect(bar.style.width).toBe('0%');
  });

  it('drives the red vignette opacity', () => {
    const doc = fakeDoc();
    const hud = createHud(doc);
    const el = doc.items.find((item) => item.id === 'vignetteRed');
    expect(el).toBeTruthy();
    hud.setVignette(0.4);
    expect(el.style.opacity).toBe(0.4);
  });
});

describe('style.css', () => {
  it('paints the damage fill green through yellow to red', () => {
    const rule = css.match(/#dmgFill\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/linear-gradient\(90deg,\s*#4ade80,\s*#facc15,\s*#ef4444\)/);
    expect(rule).toMatch(/transition:\s*width/);
  });

  it('keeps the red vignette a fixed, click-through overlay', () => {
    const rule = css.match(/#vignetteRed\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).toMatch(/rgba\(255,\s*40,\s*24/);
  });
});
