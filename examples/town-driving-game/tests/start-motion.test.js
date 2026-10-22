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

const frames = (name) => {
  const kf = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!kf) return [];
  return [...kf[0].matchAll(/\b(from|to|\d+%)\s*\{([^}]*)\}/g)].map((m) => ({ at: m[1], body: m[2] }));
};

const opacityOf = (decl) => parseFloat(decl.match(/opacity:\s*([\d.]+)/)[1]);
const translateYOf = (decl) => {
  const m = decl.match(/translateY\(\s*(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
};

// the animation values a rule actually runs (shorthand + longhand), so a comment
// that merely names a keyframe can't be mistaken for using it
const animDecls = (sel) =>
  [...ruleFor(sel).matchAll(/animation(?:-name)?:\s*([^;]+);/g)].map((m) => m[1]).join(', ');

// first animation's delay: the longhand if present, else the 2nd time value of the shorthand
const delayOf = (sel) => {
  const r = ruleFor(sel);
  const d = r.match(/animation-delay:\s*([^;]+);/);
  if (d) return parseFloat(d[1]);
  const a = r.match(/animation:\s*([^;]+);/);
  if (!a) return 0;
  const times = [...a[1].split(',')[0].matchAll(/([\d.]+)s\b/g)].map((m) => parseFloat(m[1]));
  return times.length > 1 ? times[1] : 0;
};

const rgbOf = (rule) => {
  const hex = rule.match(/background:\s*#([0-9a-f]{6})\b/i)[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

describe('start screen entrance', () => {
  it('defines a fade-up keyframe: transparent and low, opaque and in place', () => {
    const f = frames('fadeUp');
    const from = f.find((x) => x.at === 'from' || x.at === '0%');
    const to = f.find((x) => x.at === 'to' || x.at === '100%');
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    expect(opacityOf(from.body)).toBe(0);
    expect(opacityOf(to.body)).toBe(1);
    expect(translateYOf(from.body)).toBeGreaterThan(0);
    expect(translateYOf(to.body)).toBe(0);
  });

  it('fades the children up via longhands, and pulses the pill without fadeUp', () => {
    // T59: the shorthand's 0s delay beat the nth-child delays, so the children use longhands
    const kids = ruleFor('#start > *:not(#go)');
    expect(kids).toMatch(/animation-name:\s*fadeUp\b/);
    expect(kids).toMatch(/animation-fill-mode:\s*both\b/);
    // T59: a fill-both fadeUp hid the CTA until its delay ended, so #go pulses only
    const go = animDecls('#go');
    expect(go).toMatch(/\bpulse\b/);
    expect(go).not.toMatch(/fadeUp/);
  });

  it('staggers the delays title → subtitle → keys → pill → footer', () => {
    const delays = [1, 2, 3, 4, 5].map((n) => delayOf(`#start > *:nth-child(${n})`));
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
    expect(delays.at(-1)).toBeLessThan(1); // the card is fully in without dragging
  });

  it('keeps the nth-child delays strictly increasing', () => {
    // the pill shares the fadeUp stagger now, so its delay must sit between its neighbours
    const delays = [1, 2, 3, 4, 5].map((n) => delayOf(`#start > *:nth-child(${n})`));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});

describe('#go hover', () => {
  it('brightens the pill', () => {
    const [hr, hg, hb] = rgbOf(ruleFor('#go:hover'));
    const [br, bg, bb] = rgbOf(ruleFor('#go'));
    expect(hr + hg + hb).toBeGreaterThan(br + bg + bb);
    expect(Math.min(hr, hg, hb)).toBeGreaterThanOrEqual(Math.min(br, bg, bb));
  });

  it('lifts it on a property the running pulse cannot override', () => {
    // pulse animates `transform`, so a transform-based lift would never show
    expect(ruleFor('#go:hover')).toMatch(/(^|[;\s])translate:\s*0\s+-[\d.]+px/);
  });

  it('eases in rather than snapping', () => {
    const t = ruleFor('#go').match(/transition:\s*([^;]+);/)[1];
    expect(t).toMatch(/(^|\s|,)translate\s+[\d.]+s/);
    expect(t).toMatch(/background\s+[\d.]+s/);
  });
});
