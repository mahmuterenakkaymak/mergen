import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

const ruleFor = (selector) => html.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? null;

describe('index.html overlay layers', () => {
  const menu = ruleFor('#menu');

  it('declares a #menu rule', () => {
    expect(menu).not.toBeNull();
  });

  it('lets clicks fall through the empty #menu overlay to the canvas', () => {
    expect(menu).toMatch(/pointer-events:\s*none/);
  });

  it('keeps #hud click-through as well', () => {
    expect(ruleFor('#hud')).toMatch(/pointer-events:\s*none/);
  });

  it('keeps #menu above the canvas so its panels stay visible', () => {
    expect(menu).toMatch(/position:\s*fixed/);
    expect(menu).toMatch(/inset:\s*0/);
  });
});
