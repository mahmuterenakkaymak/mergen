// T69: R reset+repair shipped in T39, so the start screen and the hint strip must
// advertise it — before the car breaks, not only in the overheat toast.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const startScreen = readFileSync(join(root, 'src/ui/startScreen.js'), 'utf8');
const hud = readFileSync(join(root, 'src/hud/hud.js'), 'utf8');

describe('R reset is advertised (T69)', () => {
  it('start screen has an R keycap in the key grid', () => {
    const keys = startScreen.slice(startScreen.indexOf('class="keys"'));
    expect(keys).toContain('<kbd>R</kbd> reset &amp; repair');
  });

  it('hint strip has an R reset segment', () => {
    const hint = hud.slice(hud.indexOf('hintEl.innerHTML'));
    expect(hint).toContain('<b>R</b> reset');
  });
});
