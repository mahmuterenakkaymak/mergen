import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

// the bare `#start {` rule — not `#start.hide`, `#start h1`, etc.
const startRule = css.match(/(^|\n)#start\s*\{[^}]*\}/)[0];

describe('#start scrim', () => {
  it('blends its gradient with alpha so the attract canvas shows through', () => {
    const bg = startRule.match(/background:\s*([^;]+);/)[1];
    expect(bg).toContain('radial-gradient(');
    expect(bg).toContain('rgba(');
  });

  it('keeps every gradient stop dark and translucent, not opaque', () => {
    const stops = [...startRule.matchAll(/rgba\(([^)]+)\)/g)].map((m) =>
      m[1].split(',').map((s) => parseFloat(s.trim()))
    );
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const [r, g, b, a] of stops) {
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
      expect(Math.max(r, g, b)).toBeLessThan(128); // dark base keeps white text readable
    }
  });
});
