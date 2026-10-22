// T81: the start overlay has depth — the title and the legend ease a few pixels against
// the cursor, so the menu feels built before the click. Keys must still not start the game.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parallaxShift } from '../src/ui/startScreen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(here, '..', ...p), 'utf8');
const src = read('src', 'ui', 'startScreen.js');
const css = read('src', 'style.css');

const VIEW = [1280, 720];
const at = (x, y, d = 1) => parallaxShift(x, y, VIEW[0], VIEW[1], d);
const MAX = 12; // px per axis — "a few pixels", measured at a screen corner

describe('parallaxShift (pure)', () => {
  it('leaves the layers where they are with the pointer dead centre', () => {
    const s = at(640, 360);
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(0, 9);
  });

  it('moves opposite the pointer on both axes', () => {
    expect(at(1280, 360).x).toBeLessThan(0); // pointer right  → text left
    expect(at(0, 360).x).toBeGreaterThan(0);
    expect(at(640, 720).y).toBeLessThan(0); // pointer below → text up
    expect(at(640, 0).y).toBeGreaterThan(0);
  });

  it('grows with how far the pointer is from the centre', () => {
    expect(Math.abs(at(960, 360).x)).toBeGreaterThan(Math.abs(at(800, 360).x));
    expect(Math.abs(at(1280, 360).x)).toBeGreaterThan(Math.abs(at(960, 360).x));
  });

  it('stays a few pixels at the edge of the screen', () => {
    for (const p of [at(0, 0), at(1280, 0), at(0, 720), at(1280, 720)]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(MAX);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(MAX);
    }
  });

  it('separates the layers: a deeper one moves less', () => {
    const [front, back] = [at(0, 0, 1), at(0, 0, 0.45)];
    expect(Math.abs(front.x)).toBeGreaterThan(Math.abs(back.x));
    expect(Math.abs(front.y)).toBeGreaterThan(Math.abs(back.y));
  });

  it('cannot be pulled past the edge by a pointer reported off-viewport', () => {
    const s = at(9999, -9999);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(MAX);
    expect(Math.abs(s.y)).toBeLessThanOrEqual(MAX);
  });
});

describe('the overlay wires it', () => {
  it('tracks the pointer over the overlay', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]pointermove['"]/);
  });

  it('writes `translate`, never `transform` — fadeUp and titleDrift own transform', () => {
    expect(src).toMatch(/style\.translate\s*=/);
    expect(src).not.toMatch(/style\.transform\s*=/);
  });

  it('moves the title and the legend, and leaves the pill its own hover lift', () => {
    expect(src).toMatch(/querySelector\(\s*['"]h1['"]\s*\)/);
    expect(src).toMatch(/querySelector\(\s*['"]\.keys['"]\s*\)/);
    expect(src).not.toMatch(/querySelector\(\s*['"]#go['"]\s*\)/);
  });

  it('stops tracking once the overlay is gone', () => {
    const click = src.slice(src.indexOf("addEventListener('click'"));
    expect(click).toMatch(/removeEventListener\(\s*['"]pointermove['"]/);
  });

  it('still starts on the click alone — keys only light the caps', () => {
    const keys = src.slice(src.indexOf('const onDown'), src.indexOf("addEventListener('click'"));
    expect(keys).not.toMatch(/onStart\s*\(/);
  });
});

describe('the drift is eased', () => {
  const rule = (css.match(/[^{}]*\{[^}]*transition:[^}]*\}/g) || []).find((r) => r.includes('#start h1'));

  it('eases the layers it moves instead of snapping them to the cursor', () => {
    expect(rule).toBeDefined();
    expect(rule).toMatch(/\.keys/);
    expect(rule).toMatch(/transition:[^;]*\btranslate\b[^;]*[\d.]+m?s/);
  });

  it('takes a quarter-second or so — a trail, not a lag', () => {
    const dur = parseFloat(rule.match(/transition:[^;]*translate\s+([\d.]+)(m?s)/)[1]);
    const secs = rule.match(/transition:[^;]*translate\s+[\d.]+(m?s)/)[1] === 'ms' ? dur / 1000 : dur;
    expect(secs).toBeGreaterThan(0.1);
    expect(secs).toBeLessThan(0.5);
  });
});
