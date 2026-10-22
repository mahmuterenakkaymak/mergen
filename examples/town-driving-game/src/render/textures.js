// Facade and perimeter-wall textures. facadeSpec is the pure, seeded description of a
// building face (which windows are lit, where the storey lines fall) so the same seed
// always gives the same building; the canvas makers only paint a spec.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const FACADE_W = 128, FACADE_H = 256;
const COLS = 4, ROWS = 8;
const WIN_X = 10, WIN_Y = 12, WIN_W = 18, WIN_H = 16;
const PITCH_X = 29, PITCH_Y = 30;
const FLOOR_STEP = 32, FLOOR_LINE = 2;
const LIT_CHANCE = 0.28;
const GLASS_SHEEN = 'rgba(255,255,255,0.14)';
const SLAB_SHADE = 'rgba(0,0,0,0.10)';

const STRIPES = 4, STRIPE_W = 16, STRIPE_H = 32;

// ASSUMPTION: "grid 4x8" = 4 columns x 8 rows, lit ~28% rolled per window like the prototype.
export function facadeSpec(rng, baseColor) {
  const lit = [];
  for (let i = 0; i < COLS * ROWS; i++) lit.push(rng.float() < LIT_CHANCE);
  const floors = [];
  for (let y = 0; y + FLOOR_STEP <= FACADE_H; y += FLOOR_STEP) floors.push(y);
  return {
    width: FACADE_W,
    height: FACADE_H,
    base: baseColor,
    cols: COLS,
    rows: ROWS,
    lit,
    floors,
  };
}

export function makeFacadeTexture(spec) {
  if (typeof document === 'undefined') return null; // headless: caller keeps a flat base colour
  const { canvas: c, g } = paint(spec.width, spec.height);
  g.fillStyle = spec.base;
  g.fillRect(0, 0, spec.width, spec.height);
  g.fillStyle = SLAB_SHADE;
  for (const y of spec.floors) g.fillRect(0, y, spec.width, FLOOR_LINE);
  spec.lit.forEach((on, i) => {
    const x = WIN_X + (i % spec.cols) * PITCH_X;
    const y = WIN_Y + Math.floor(i / spec.cols) * PITCH_Y;
    g.fillStyle = on ? CONFIG.colors.windowLit : CONFIG.colors.windowDark;
    g.fillRect(x, y, WIN_W, WIN_H);
    g.fillStyle = GLASS_SHEEN;
    g.fillRect(x, y, WIN_W, 4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeStripeTexture() {
  if (typeof document === 'undefined') return null;
  const w = STRIPES * STRIPE_W;
  const { canvas: c, g } = paint(w, STRIPE_H);
  for (let i = 0; i < STRIPES; i++) {
    g.fillStyle = CONFIG.colors.wallStripe[i % 2];
    g.fillRect(i * STRIPE_W, 0, STRIPE_W, STRIPE_H);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  // The stripes are a warning pattern: keep the edges hard instead of smoothing them.
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function paint(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, g: canvas.getContext('2d') };
}
