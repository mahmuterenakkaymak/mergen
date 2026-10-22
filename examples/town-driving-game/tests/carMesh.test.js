import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCarMesh, updateCarMesh } from '../src/render/carMesh.js';
import { createCar } from '../src/car.js';

const DT = 1 / 60;
const makeCar = (over) => Object.assign(createCar({ x: 0, z: 0, heading: 0 }), over);

describe('buildCarMesh', () => {
  it('builds a group with a metallic body and a dark glass cabin', () => {
    const m = buildCarMesh(0xd62828);
    expect(m.g).toBeInstanceOf(THREE.Group);
    expect(m.bodyMat.metalness).toBeGreaterThan(0.4);
    expect(m.bodyMat.color.getHex()).toBe(0xd62828);
    const cabin = m.chassis.children.find((c) => c.material?.color.getHex() === 0x141a22);
    expect(cabin).toBeDefined();
    expect(cabin.material.roughness).toBeLessThan(0.3); // glassy
    expect(cabin.castShadow).toBe(true);
  });

  it('has bumpers, headlights in front and tail lights at the back', () => {
    const m = buildCarMesh();
    const bumpers = m.chassis.children.filter((c) => c.material?.color.getHex() === 0x22262c);
    const heads = m.chassis.children.filter((c) => c.material?.color.getHex() === 0xfff6c8);
    const tails = m.chassis.children.filter((c) => c.material === m.tailMat);
    expect(bumpers).toHaveLength(2);
    expect(heads).toHaveLength(2);
    expect(tails).toHaveLength(2);
    for (const h of heads) expect(h.position.z).toBeGreaterThan(0);
    for (const t of tails) expect(t.position.z).toBeLessThan(0);
  });

  it('has 4 wheels on pivots and 2 front steer pivots', () => {
    const m = buildCarMesh();
    expect(m.wheels).toHaveLength(4);
    expect(m.steers).toHaveLength(2);
    for (const p of m.steers) {
      expect(p).toBeInstanceOf(THREE.Group);
      expect(p.position.z).toBeGreaterThan(0); // front of the car (+z)
      expect(m.g.children).toContain(p);
    }
    for (const w of m.wheels) expect(w.castShadow).toBe(true);
  });
});

describe('updateCarMesh', () => {
  it('copies position and heading to the group', () => {
    const m = buildCarMesh();
    updateCarMesh(m, makeCar({ x: 12.5, z: -7, heading: 0.6 }), DT);
    expect(m.g.position.x).toBe(12.5);
    expect(m.g.position.y).toBe(0);
    expect(m.g.position.z).toBe(-7);
    expect(m.g.rotation.y).toBe(0.6);
  });

  it('spins wheels by ground speed, backwards in reverse', () => {
    const m = buildCarMesh();
    updateCarMesh(m, makeCar({ speed: 8.4 }), 0.5);
    for (const w of m.wheels) expect(w.rotation.x).toBeCloseTo(10, 9); // 8.4 / 0.42 * 0.5
    updateCarMesh(m, makeCar({ speed: -8.4 }), 0.5);
    for (const w of m.wheels) expect(w.rotation.x).toBeCloseTo(0, 9);
  });

  it('applies the steer angle to the front pivots', () => {
    const m = buildCarMesh();
    updateCarMesh(m, makeCar({ steer: 0.35 }), DT);
    for (const s of m.steers) expect(s.rotation.y).toBeCloseTo(0.35, 9);
  });

  it('glows brake lights while braking and dims them again', () => {
    const m = buildCarMesh();
    const off = m.tailMat.color.getHex();
    updateCarMesh(m, makeCar({ braking: true }), DT);
    const on = m.tailMat.color.getHex();
    expect(on).not.toBe(off);
    expect(on).toBe(0xff2020);
    updateCarMesh(m, makeCar({}), DT);
    expect(m.tailMat.color.getHex()).toBe(off);
  });

  it('darkens the paint with damage and restores it at 0', () => {
    const m = buildCarMesh(0xd62828);
    const base = m.bodyMat.color.clone();
    updateCarMesh(m, makeCar({ damage: 100 }), DT);
    expect(m.bodyMat.color.r).toBeLessThan(base.r);
    expect(m.bodyMat.color.r).toBeGreaterThan(0);
    updateCarMesh(m, makeCar({ damage: 0 }), DT);
    expect(m.bodyMat.color.r).toBeCloseTo(base.r, 9);
  });
});
