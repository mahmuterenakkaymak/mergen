import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'src', 'style.css'), 'utf8');
const main = readFileSync(path.join(here, '..', 'src', 'main.js'), 'utf8');

const hideRule = css.match(/body:not\(\.playing\)\s+\.hud\s*\{[^}]*\}/);

describe('HUD hidden until the game starts', () => {
  it('style.css hides .hud while body lacks the playing class', () => {
    expect(hideRule).not.toBeNull();
    expect(hideRule[0]).toMatch(/opacity:\s*0\s*;?\s*\}/);
  });

  it('the start handler adds playing to body.classList', () => {
    expect(main).toMatch(/document\.body\.classList\.add\(\s*['"]playing['"]\s*\)/);
  });
});
