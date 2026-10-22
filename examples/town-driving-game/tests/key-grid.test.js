// T72: two columns flow the key rows row-major, so the eye zig-zags and splits
// throttle from steer. The legend reads as one list, top to bottom.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

// the top-level rule only — the phone override is indented inside its @media block
const baseKeys = css.match(/(^|\n)\.keys\s*\{[^}]*\}/)[0];

describe('key legend is a single column (T72)', () => {
  it('puts every key row in one column on desktop', () => {
    const cols = baseKeys.match(/grid-template-columns:\s*([^;]+);/)[1].trim();
    expect(cols).toBe('1fr');
  });

  it('keeps a gap between the rows it now stacks', () => {
    expect(baseKeys).toMatch(/gap:\s*[^;]+;/);
  });
});
