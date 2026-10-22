// T74: the start legend answers the keyboard — pressing a shown key lights its cap,
// so the controls are taught by doing. Keys must not start the game; only the click does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'startScreen.js'),
  'utf8'
);

describe('start-screen keycaps light on keydown (T74)', () => {
  it('registers a keydown listener while the overlay is up', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]keydown['"]/);
  });

  it('toggles a class on the kbd elements', () => {
    // the caps come from the kbd nodes, and a class is added/removed on them
    expect(src).toMatch(/querySelectorAll\(\s*['"]kbd['"]/);
    expect(src).toMatch(/classList\.(add|remove|toggle)\(\s*['"]lit['"]/);
  });
});
