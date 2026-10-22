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
const bg = startRule.match(/background:\s*([^;]+);/)[1];
const alphas = [...bg.matchAll(/rgba\(([^)]*)\)/g)].map(
  (m) => parseFloat(m[1].split(/[\s,]+/).filter(Boolean).pop())
);

describe('#start scrim balance', () => {
  it('reads the gradient stop alphas', () => {
    expect(alphas.length).toBeGreaterThanOrEqual(2);
    for (const a of alphas) expect(Number.isNaN(a)).toBe(false);
  });

  it('keeps the centre translucent so the attract-orbit town is readable', () => {
    expect(alphas[0]).toBeLessThanOrEqual(0.65);
  });

  it('keeps the outer scrim below near-opaque', () => {
    expect(alphas[alphas.length - 1]).toBeLessThanOrEqual(0.88);
  });
});
