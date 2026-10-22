import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'),
  'utf8'
);

// the bare `#start h1` rule — not `#start h2`, not a `#start h1:whatever` variant
const ruleFor = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(^|\\n)${esc}\\s*\\{[^}]*\\}`));
  return m ? m[0] : '';
};

const animOf = (rule) => {
  const m = rule.match(/(^|[;\s])animation:\s*([^;]+);/);
  return m ? m[2].replace(/!important/, '').trim() : '';
};

// one entry per animation in the list, name first: "fadeUp 0.5s ease-out both"
const segmentsOf = (anim) => anim.split(',').map((s) => s.trim()).filter(Boolean);
const segmentFor = (anim, name) => segmentsOf(anim).find((s) => new RegExp(`^${name}\\b`).test(s));

const framesOf = (name) => {
  const m = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) return [];
  return [...m[1].matchAll(/\b(from|to|\d+%)\s*\{([^}]*)\}/g)].map((f) => ({ at: f[1], body: f[2] }));
};

const h1 = ruleFor('#start h1');
const anim = animOf(h1);
// the drift is whatever the title animates besides its entrance
const drift = segmentsOf(anim).find((s) => !/^fadeUp\b/.test(s)) || '';
const driftName = drift.split(/\s+/)[0] || '';

describe('#start h1 wordmark motion', () => {
  it('animates the title, so it is not dead flat once the entrance ends', () => {
    expect(anim).not.toBe('');
    expect(driftName).toMatch(/[a-z]/i);
  });

  it('keeps the entrance fade-up in the same animation list', () => {
    // the drift replaces animation-name, so fadeUp has to ride along or the title pops in
    expect(segmentFor(anim, 'fadeUp')).toBeTruthy();
  });

  it('outlasts the entrance rule that owns animation-name', () => {
    // `#start > *:not(#go)` is #id + :not(#id) (2,0,0) and beats `#start h1` (1,0,1);
    // without !important it wins animation-name, fadeUp loops forever and nothing drifts
    expect(h1).toMatch(/(^|[;\s])animation:[^;]*!important\s*;/);
  });

  it('drifts slowly and forever', () => {
    const times = [...drift.matchAll(/([\d.]+)s\b/g)].map((m) => parseFloat(m[1]));
    expect(times[0]).toBeGreaterThanOrEqual(6);
    expect(times[0]).toBeLessThanOrEqual(8);
    expect(drift).toMatch(/\binfinite\b/);
  });

  it('oversizes the gradient on the axis it slides', () => {
    // `background-size: 200%` alone leaves the height auto (= 100%), and a vertical
    // gradient with nothing to scroll shows no motion from a background-position change
    const sizes = h1.match(/background-size:\s*([^;]+);/)[1].trim().split(/\s+/).map(parseFloat);
    expect(sizes[1] ?? sizes[0]).toBeGreaterThanOrEqual(200);
  });
});

describe('the drift keyframe', () => {
  const frames = framesOf(driftName);

  it('exists and moves background-position between two stops', () => {
    const pos = frames.map((f) => (f.body.match(/background-position:\s*([^;]+)/) || [])[1]);
    const moved = pos.filter(Boolean);
    expect(moved.length).toBeGreaterThanOrEqual(2);
    expect(new Set(moved).size).toBeGreaterThanOrEqual(2);
  });

  it('comes back where it started, so the loop has no jump', () => {
    const posAt = (want) => {
      const f = frames.find((x) => ({ '0%': 'from', '100%': 'to' }[x.at] || x.at) === want);
      return f ? (f.body.match(/background-position:\s*([^;]+)/) || [])[1] : undefined;
    };
    expect(posAt('from')).toBeDefined();
    expect(posAt('to')).toBeDefined();
    expect(posAt('from')).toBe(posAt('to'));
  });
});
