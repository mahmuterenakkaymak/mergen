// T80: in the dusk attract shot the parked hero car was a dark silhouette. It has to light
// its own lamps while the start screen is up — glowing tail lights and a faint warm pool of
// headlight on the road — so it reads as "yours, ready to go".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { buildCarMesh, updateCarMesh, setLamps } from '../src/render/carMesh.js';
import { createCar } from '../src/car.js';

// main.js needs a browser, so the wiring is checked in its source.
const mainSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.js'),
  'utf8'
);

const DT = 1 / 60;
const TAIL_OFF = 0x8a1010;
const TAIL_ON = 0xff2020;
const makeCar = (over) => Object.assign(createCar({ x: 0, z: 0, heading: 0 }), over);

describe('car lamps', () => {
  it('is dark until the lamps are asked for', () => {
    const m = buildCarMesh();
    expect(m.beam.visible).toBe(false);
    expect(m.tailMat.color.getHex()).toBe(TAIL_OFF);
  });

  it('lights the tail and washes a warm pool on the road ahead', () => {
    const m = buildCarMesh();
    setLamps(m, true);
    expect(m.tailMat.color.getHex()).toBe(TAIL_ON);
    expect(m.beam.visible).toBe(true);
    expect(m.beam.position.z).toBeGreaterThan(0); // ahead of the car (+z), where the lamps point
    expect(m.beam.rotation.x).toBeCloseTo(-Math.PI / 2, 9); // flat on the road
    expect(m.beam.position.y).toBeGreaterThan(0); // just off the asphalt, so it cannot z-fight
    expect(m.beam.position.y).toBeLessThan(0.1);
    expect(m.beam.material.blending).toBe(THREE.AdditiveBlending); // adds light, never paints a card
    expect(m.beam.material.depthWrite).toBe(false);
    expect(m.beam.material.color.getHex()).not.toBe(0xfff6c8); // not mistaken for a headlamp lens
  });

  it('goes dark again when the player takes the wheel', () => {
    const m = buildCarMesh();
    setLamps(m, true);
    setLamps(m, false);
    expect(m.beam.visible).toBe(false);
    expect(m.tailMat.color.getHex()).toBe(TAIL_OFF);
  });

  it('holds the glow through the per-frame mesh update', () => {
    const m = buildCarMesh();
    setLamps(m, true);
    updateCarMesh(m, makeCar({}), DT);
    expect(m.tailMat.color.getHex()).toBe(TAIL_ON);
    expect(m.beam.visible).toBe(true);
  });

  it('gives the brake light back once the lamps are off', () => {
    const m = buildCarMesh();
    setLamps(m, true);
    setLamps(m, false);
    updateCarMesh(m, makeCar({}), DT);
    expect(m.tailMat.color.getHex()).toBe(TAIL_OFF);
    updateCarMesh(m, makeCar({ braking: true }), DT);
    expect(m.tailMat.color.getHex()).toBe(TAIL_ON);
  });

  it('runs the lamps in the attract branch and drops them at the start', () => {
    expect(mainSrc).toMatch(/stepAmbient\(world, dt\)[\s\S]{0,600}?setLamps\(carMesh, true\)/);
    expect(mainSrc).toMatch(/setLamps\(carMesh, false\)/);
  });
});
