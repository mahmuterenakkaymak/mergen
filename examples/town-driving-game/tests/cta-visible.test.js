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

describe('start screen CTA visibility', () => {
  it('spells the entrance in longhands so the stagger delays survive', () => {
    const r = ruleFor('#start > *:not(#go)');
    expect(r).toMatch(/animation-name:\s*fadeUp\b/);
    // the shorthand carries `animation-delay: 0s`, which at 2,0,0 would beat nth-child(n)
    expect(r).not.toMatch(/(^|[;{\s])animation\s*:/);
    expect(r).not.toMatch(/animation-delay\s*:/);
  });

  it('keeps the entrance duration, easing and fill it had as a shorthand', () => {
    const r = ruleFor('#start > *:not(#go)');
    expect(r).toMatch(/animation-duration:\s*[\d.]+s\s*;/);
    expect(r).toMatch(/animation-timing-function:\s*[\w-]+\s*;/);
    expect(r).toMatch(/animation-fill-mode:\s*both\s*;/);
  });

  it('pulses the pill without a fill-both fade that hides it for the first frames', () => {
    const anim = ruleFor('#go').match(/animation:\s*([^;]+);/)[1];
    expect(anim).toMatch(/\bpulse\b/);
    expect(anim).not.toMatch(/\b(both|backwards)\b/);
  });
});
