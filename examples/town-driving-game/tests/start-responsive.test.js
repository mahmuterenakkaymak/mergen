import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

const rule = (sel) => css.match(new RegExp(`(^|\\n)${sel}\\s*\\{[^}]*\\}`))[0];

// top-level @media blocks (closing brace on its own line)
const mediaBlocks = [...css.matchAll(/@media([^{]*)\{([\s\S]*?)\n\}/g)].map((m) => ({
  cond: m[1],
  body: m[2],
}));

const phone = mediaBlocks.find((b) => /#start|\.keys/.test(b.body));

describe('start screen on a 390px phone', () => {
  it('scales the title with clamp() instead of a fixed px size', () => {
    expect(rule('#start h1')).toMatch(/font-size:\s*clamp\(/);
    expect(rule('#start h1')).toMatch(/letter-spacing:\s*clamp\(/);
  });

  it('scales the subtitle with clamp() too', () => {
    expect(rule('#start h2')).toMatch(/font-size:\s*clamp\(/);
    expect(rule('#start h2')).toMatch(/letter-spacing:\s*clamp\(/);
  });

  it('clamps the title below the old desktop size so it fits a narrow screen', () => {
    for (const m of rule('#start h1').matchAll(/clamp\(([^)]*)\)/g)) {
      const [min, , max] = m[1].split(',').map((s) => parseFloat(s));
      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThan(min);
      expect(max).toBeLessThanOrEqual(76);
    }
  });

  it('has a phone media query touching the start screen', () => {
    expect(phone).toBeDefined();
    expect(phone.cond).toMatch(/max-width:\s*(480|4[0-7][0-9]|3[0-9][0-9])px/);
  });

  it('collapses the keycap grid to one column with a tighter gap', () => {
    const keys = phone.body.match(/\.keys\s*\{[^}]*\}/)[0];
    const cols = keys.match(/grid-template-columns:\s*([^;]+);/)[1].trim();
    expect(cols.split(/\s+/)).toHaveLength(1);
    expect(keys).toMatch(/gap:\s*[^;]+;/);
    const baseGap = rule('.keys').match(/gap:\s*([^;]+);/)[1];
    expect(keys.match(/gap:\s*([^;]+);/)[1]).not.toBe(baseGap);
  });
});
