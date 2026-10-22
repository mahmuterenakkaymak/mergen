// T62/T85: the UI copy must match what the game actually does — no claims about features
// that are not there (traffic/pedestrians), and no key dropped from the legend once it works
// (R reset+repair landed in T39, so T69 put it back on both the start screen and the strip).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const startScreen = readFileSync(join(root, 'src/ui/startScreen.js'), 'utf8');
const hud = readFileSync(join(root, 'src/hud/hud.js'), 'utf8');

describe('UI copy matches what M2 actually does (T62)', () => {
  it('start screen advertises the R keycap', () => {
    expect(startScreen).toContain('<kbd>R</kbd>');
  });

  it('start screen footer makes no traffic/pedestrians claim', () => {
    expect(startScreen).not.toContain('traffic and pedestrians');
  });

  it('hint strip has an R reset segment', () => {
    expect(hud).toContain('<b>R</b> reset');
  });

  it('keeps the claim that is true today', () => {
    expect(startScreen).toContain('same town every run');
  });
});
