import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { facadeSpec, makeFacadeTexture, makeStripeTexture } from '../src/render/textures.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const stream = () => createRng(CONFIG.seed).fork('facades');
// fork(label) is a hash-seeded stream, so each spec depends on its own label only.
const many = (n) =>
  Array.from({ length: n }, (_, i) => facadeSpec(stream().fork(String(i)), CONFIG.palette[i % CONFIG.palette.length]));

// Vitest runs in Node: the canvas path is exercised against a recorder that logs every
// fillStyle/fillRect pair the painter emits.
function withCanvas(paint) {
  const ops = [];
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        set fillStyle(v) { ops.push({ fill: v }); },
        fillRect(x, y, w, h) { ops.push({ x, y, w, h }); },
      }),
    }),
  };
  try {
    return { tex: paint(), ops };
  } finally {
    delete globalThis.document;
  }
}

const fillsOf = (ops) => ops.filter((o) => o.fill !== undefined).map((o) => o.fill);
const rectsOf = (ops) => ops.filter((o) => o.fill === undefined);

describe('facadeSpec', () => {
  it('lays a 4x8 window grid over the base colour it is given', () => {
    const spec = facadeSpec(stream(), CONFIG.palette[3]);
    expect(spec.base).toBe(CONFIG.palette[3]);
    expect([spec.cols, spec.rows]).toEqual([4, 8]);
    expect(spec.lit).toHaveLength(spec.cols * spec.rows);
    expect(spec.lit.every((b) => typeof b === 'boolean')).toBe(true);
    expect(spec.width).toBeGreaterThan(0);
    expect(spec.height).toBeGreaterThan(spec.width); // a face is taller than it is wide
  });

  it('is the same spec for the same seed', () => {
    expect(facadeSpec(stream(), '#8d99ae')).toEqual(facadeSpec(stream(), '#8d99ae'));
    expect(many(6)).toEqual(many(6));
  });

  it('changes the lit windows from building to building', () => {
    expect(new Set(many(24).map((s) => s.lit.join(''))).size).toBeGreaterThan(1);
  });

  it('lights about 28% of the windows', () => {
    const all = many(60).flatMap((s) => s.lit);
    const ratio = all.filter(Boolean).length / all.length;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.36);
  });

  it('runs a storey line across every floor', () => {
    const spec = facadeSpec(stream(), '#8d99ae');
    expect(spec.floors.length).toBeGreaterThanOrEqual(spec.rows);
    expect(spec.floors[0]).toBe(0);
    const step = spec.floors[1] - spec.floors[0];
    expect(spec.floors.every((y, i) => i === 0 || y - spec.floors[i - 1] === step)).toBe(true);
    // the top storey gets its line too: the last one sits within one step of the bottom edge
    expect(spec.floors.at(-1) + step).toBeGreaterThan(spec.height - step);
  });
});

describe('makeFacadeTexture', () => {
  it('gives back nothing when there is no canvas to paint on', () => {
    expect(makeFacadeTexture(facadeSpec(stream(), '#8d99ae'))).toBeNull();
    expect(makeStripeTexture()).toBeNull();
  });

  it('paints the base, one line per storey and every window', () => {
    const spec = facadeSpec(stream(), CONFIG.palette[0]);
    const { tex, ops } = withCanvas(() => makeFacadeTexture(spec));

    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);

    const fills = fillsOf(ops);
    const rects = rectsOf(ops);
    expect(fills[0]).toBe(spec.base);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: spec.width, h: spec.height });

    expect(fills.filter((f) => f === CONFIG.colors.windowLit)).toHaveLength(spec.lit.filter(Boolean).length);
    expect(fills.filter((f) => f === CONFIG.colors.windowDark)).toHaveLength(spec.lit.filter((b) => !b).length);
    expect(rects.filter((r) => r.h === 2)).toHaveLength(spec.floors.length);

    const windows = rects.filter((r) => r.w === 18 && r.h === 16);
    expect(windows).toHaveLength(spec.cols * spec.rows);
    for (const w of windows) {
      expect(w.x + w.w).toBeLessThanOrEqual(spec.width);
      expect(w.y + w.h).toBeLessThanOrEqual(spec.height);
    }
  });
});

describe('makeStripeTexture', () => {
  it('paints the perimeter wall in alternating red and white', () => {
    const { tex, ops } = withCanvas(() => makeStripeTexture());

    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping); // the wall runs for hundreds of metres: the pattern must tile
    expect(tex.magFilter).toBe(THREE.NearestFilter); // hard edges, so the bands stay readable at a distance

    const [red, white] = CONFIG.colors.wallStripe;
    const fills = fillsOf(ops);
    expect(fills.length % 2).toBe(0);
    expect(fills.every((f, i) => f === (i % 2 ? white : red))).toBe(true);

    const rects = rectsOf(ops);
    expect(rects).toHaveLength(fills.length);
    expect(new Set(rects.map((r) => r.w)).size).toBe(1); // equal bands, so the repeat has no seam
    expect(rects.every((r, i) => r.x === i * r.w && r.y === 0)).toBe(true);
  });
});
