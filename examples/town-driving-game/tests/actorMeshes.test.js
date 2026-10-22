import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildPedMesh, updatePedMesh, buildTrafficPool, updateTrafficPool,
} from '../src/render/actorMeshes.js';
import { makePeds } from '../src/peds.js';
import { makeTraffic } from '../src/traffic.js';
import { generateTown } from '../src/town.js';
import { createRng } from '../src/util/rng.js';
import { CONFIG } from '../src/config.js';

const town = generateTown(CONFIG.seed, CONFIG);
const peds = makePeds(createRng(CONFIG.seed).fork('peds'), town);
const traffic = makeTraffic(createRng(CONFIG.seed).fork('traffic'), town);

const mkPed = (over) => ({
  axis: 'x', dir: 1, x: 0, z: 0, phase: 0, panic: 0, color: 0xef476f, ...over,
});
const parts = (g) => g.children.filter((c) => c.isMesh);

describe('buildPedMesh', () => {
  it('is a capsule torso, a head above it and two hip-hinged legs', () => {
    const m = buildPedMesh(0xef476f);
    const torso = parts(m.g).find((o) => o.geometry.type === 'CapsuleGeometry');
    const head = parts(m.g).find((o) => o.geometry.type === 'SphereGeometry');
    expect(torso).toBeDefined();
    expect(head).toBeDefined();
    expect(head.position.y).toBeGreaterThan(torso.position.y);
    expect(m.legL).toBeInstanceOf(THREE.Group);
    expect(m.legR).toBeInstanceOf(THREE.Group);
    for (const leg of [m.legL, m.legR]) {
      expect(m.g.children).toContain(leg);
      expect(leg.position.y).toBeGreaterThan(0); // hinged at the hip...
      expect(leg.children[0].position.y).toBeLessThan(0); // ...with the leg hanging below
      expect(leg.children[0].geometry.type).toBe('BoxGeometry');
    }
    expect(m.legL.position.x).not.toBe(m.legR.position.x); // one each side
  });

  it('wears its palette colour and casts shadows', () => {
    const m = buildPedMesh(0x118ab2);
    expect(m.torsoMat.color.getHex()).toBe(0x118ab2);
    for (const o of parts(m.g)) {
      expect(o.castShadow).toBe(true);
      expect(o.material.metalness).toBe(0); // cloth and skin, not car paint
    }
  });
});

describe('updatePedMesh', () => {
  it('stands the walker on the pavement, facing the way it walks', () => {
    const m = buildPedMesh();
    updatePedMesh(m, mkPed({ x: 12.5, z: -7, axis: 'x', dir: 1 }));
    expect(m.g.position.x).toBe(12.5);
    expect(m.g.position.z).toBe(-7);
    expect(m.g.position.y).toBeGreaterThanOrEqual(0);
    expect(m.g.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    updatePedMesh(m, mkPed({ axis: 'z', dir: 1 }));
    expect(m.g.rotation.y).toBeCloseTo(0, 9);
    updatePedMesh(m, mkPed({ axis: 'z', dir: -1 }));
    expect(m.g.rotation.y).toBeCloseTo(Math.PI, 9);
    updatePedMesh(m, mkPed({ axis: 'x', dir: -1 }));
    expect(m.g.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('swings the two legs in opposite phase, following the sim phase', () => {
    const m = buildPedMesh();
    updatePedMesh(m, mkPed({ phase: Math.PI / 2 }));
    expect(m.legL.rotation.x).toBeGreaterThan(0);
    expect(m.legR.rotation.x).toBeLessThan(0);
    expect(m.legR.rotation.x).toBeCloseTo(-m.legL.rotation.x, 9);
    updatePedMesh(m, mkPed({ phase: -Math.PI / 2 }));
    expect(m.legL.rotation.x).toBeLessThan(0); // the stride has swapped over
    expect(Math.abs(m.legL.rotation.x)).toBeLessThan(1); // never a leg wound past the hip
  });

  it('bobs twice a stride, highest as the legs pass and never through the ground', () => {
    const m = buildPedMesh();
    updatePedMesh(m, mkPed({ phase: 0 }));
    const high = m.g.position.y;
    updatePedMesh(m, mkPed({ phase: Math.PI / 2 }));
    const low = m.g.position.y;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high - low).toBeLessThan(0.12); // a step, not a hop
  });

  it('dresses every walker the town spawns in its own colour, without a NaN', () => {
    for (const p of peds) {
      const m = buildPedMesh(p.color);
      updatePedMesh(m, p);
      expect(m.torsoMat.color.getHex()).toBe(p.color);
      const vals = [
        m.g.position.x, m.g.position.y, m.g.position.z, m.g.rotation.y,
        m.legL.rotation.x, m.legR.rotation.x,
      ];
      for (const v of vals) expect(Number.isFinite(v)).toBe(true);
      expect(m.g.position.x).toBe(p.x);
      expect(m.g.position.z).toBe(p.z);
    }
  });
});

describe('buildTrafficPool', () => {
  it('gives every AI car its own car view in the colour the sim picked', () => {
    const pool = buildTrafficPool(traffic);
    expect(pool.cars).toHaveLength(traffic.length);
    expect(pool.g.children).toHaveLength(traffic.length);
    for (let i = 0; i < pool.cars.length; i++) {
      expect(pool.g.children[i]).toBe(pool.cars[i].g);
      expect(CONFIG.colors.traffic).toContain(traffic[i].color);
      expect(pool.cars[i].bodyMat.color.getHex()).toBe(traffic[i].color);
    }
  });
});

describe('updateTrafficPool', () => {
  it('moves each car view with its AI car', () => {
    const pool = buildTrafficPool(traffic);
    updateTrafficPool(pool, traffic, 1 / 60);
    for (let i = 0; i < pool.cars.length; i++) {
      const { position, rotation } = pool.cars[i].g;
      expect(position.x).toBe(traffic[i].x);
      expect(position.z).toBe(traffic[i].z);
      expect(position.y).toBe(0);
      expect(rotation.y).toBe(traffic[i].heading);
    }
  });

  it('rolls the wheels at the AI car speed and keeps its front wheels straight', () => {
    const pool = buildTrafficPool(traffic);
    updateTrafficPool(pool, traffic, 0.5);
    for (const car of pool.cars) {
      const spin = car.wheels[0].rotation.x;
      expect(spin).toBeGreaterThan(0);
      for (const w of car.wheels) expect(w.rotation.x).toBeCloseTo(spin, 9);
      for (const s of car.steers) expect(s.rotation.y).toBe(0); // AI cars carry no steer
    }
  });
});
