import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

const ruleFor = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(^|\\n)${esc}\\s*\\{[^}]*\\}`));
  return m ? m[0] : '';
};

describe('start screen key legend legibility', () => {
  it('puts a shadow under the plain key labels, which cross the lit facades', () => {
    expect(ruleFor('.keys')).toMatch(/text-shadow:\s*[^;]+;/);
  });

  it('keeps the shadow dark enough to read over a lit facade', () => {
    const shadow = ruleFor('.keys').match(/text-shadow:\s*([^;]+);/)[1];
    const alpha = Number(shadow.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)[1]);
    expect(alpha).toBeGreaterThanOrEqual(0.7);
  });
});
