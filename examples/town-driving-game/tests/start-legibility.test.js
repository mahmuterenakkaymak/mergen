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

const hexLum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('start screen small-text legibility', () => {
  it('puts a shadow under the 12px footer line', () => {
    expect(ruleFor('#start .foot')).toMatch(/text-shadow:\s*[^;]+;/);
  });

  it('lightens the footer ink past the scrim floor', () => {
    const hex = ruleFor('#start .foot').match(/color:\s*(#[0-9a-fA-F]{6})/)[1];
    expect(hexLum(hex)).toBeGreaterThan(hexLum('#9ab4d0'));
  });

  it('puts a shadow under the subtitle, which sits over the facades', () => {
    expect(ruleFor('#start h2')).toMatch(/text-shadow:\s*[^;]+;/);
  });
});
