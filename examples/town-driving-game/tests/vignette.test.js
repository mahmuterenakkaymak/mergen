import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHud } from '../src/hud/hud.js';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

// the bare `#vignette {` rule — not any nested/compound selector
const vignetteRule = css.match(/(^|\n)#vignette\s*\{[^}]*\}/)[0];

describe('#vignette style', () => {
  it('is a fixed, click-through overlay', () => {
    expect(vignetteRule).toMatch(/position:\s*fixed/);
    expect(vignetteRule).toMatch(/pointer-events:\s*none/);
  });

  it('sits below the HUD', () => {
    const hudZ = Number(css.match(/\.hud\s*\{[^}]*z-index:\s*(\d+)/)[1]);
    const vZ = Number(vignetteRule.match(/z-index:\s*(\d+)/)[1]);
    expect(vZ).toBeLessThan(hudZ);
  });

  it('darkens the edges from a transparent center', () => {
    const bg = vignetteRule.match(/background:\s*([^;]+);/)[1];
    expect(bg).toMatch(/radial-gradient\([^,]+,\s*transparent\b/);
    const [r, g, b, a] = bg.match(/rgba\(([^)]+)\)/)[1].split(',').map(parseFloat);
    expect(Math.max(r, g, b)).toBeLessThan(128); // dark tint
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});

describe('createHud', () => {
  it('creates a #vignette element', () => {
    const items = [];
    const doc = {
      body: { appendChild: (el) => items.push(el) },
      createElement: () => ({ id: '', className: '', textContent: '', innerHTML: '', append() {} }),
    };
    createHud(doc);
    expect(items.map((el) => el.id)).toContain('vignette');
  });
});
