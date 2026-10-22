import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildTownMeshes } from '../src/render/townMeshes.js';
import { generateTown } from '../src/town.js';
import { CONFIG } from '../src/config.js';

const SLAB_H = 0.16; // sidewalk top, the level buildings and trees stand on

const town = generateTown();
const meshes = buildTownMeshes(town);

const drawables = (g) => {
  let n = 0;
  g.traverse((o) => { if (o.isMesh) n++; });
  return n;
};
const instances = (im) => Array.from({ length: im.count }, (_, k) => {
  const m = new THREE.Matrix4();
  im.getMatrixAt(k, m);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, s };
});
const snapshot = (bag) => [
  bag.sidewalks, ...bag.buildings, bag.caps, bag.lawns, bag.ponds,
  bag.dashes, bag.trunks, bag.leaves, bag.poles, bag.heads, bag.walls,
].flatMap((im) => Array.from({ length: im.count }, (_, k) => {
  const m = new THREE.Matrix4();
  im.getMatrixAt(k, m);
  return m.elements.join(',');
}));

describe('buildTownMeshes', () => {
  it('gives every block one instanced sidewalk slab that catches shadows', () => {
    expect(meshes.sidewalks.isInstancedMesh).toBe(true);
    expect(meshes.sidewalks.count).toBe(town.blocks.length);
    expect(meshes.sidewalks.receiveShadow).toBe(true);
    expect(meshes.sidewalks.castShadow).toBe(false);
  });

  it('draws buildings as one InstancedMesh per facade used, counts matching the town', () => {
    const facades = new Set(town.buildings.map((b) => b.facade));
    expect(meshes.buildings.length).toBe(facades.size);
    expect(meshes.buildings.every((im) => im.isInstancedMesh)).toBe(true);
    const total = meshes.buildings.reduce((n, im) => n + im.count, 0);
    expect(total).toBe(town.buildings.length);
    for (const im of meshes.buildings) {
      expect(facades.has(im.userData.facade)).toBe(true);
      expect(im.castShadow).toBe(true);
      expect(im.receiveShadow).toBe(true);
    }
  });

  it('places and scales every building instance where the town says', () => {
    const want = town.buildings
      .map((b) => ({ b, cx: b.x + b.w / 2, cz: b.z + b.d / 2 }))
      .sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    const got = meshes.buildings.flatMap(instances).sort((a, b) => a.p.x - b.p.x || a.p.z - b.p.z);
    expect(got).toHaveLength(want.length);
    got.forEach((g, i) => {
      const b = want[i].b;
      expect(g.p.x).toBeCloseTo(b.x + b.w / 2, 4);
      expect(g.p.y).toBeCloseTo(SLAB_H + b.height / 2, 4);
      expect(g.p.z).toBeCloseTo(b.z + b.d / 2, 4);
      expect(g.s.x).toBeCloseTo(b.w, 4);
      expect(g.s.y).toBeCloseTo(b.height, 4);
      expect(g.s.z).toBeCloseTo(b.d, 4);
    });
  });

  it('keeps the flat palette colour per facade when there are no canvas textures', () => {
    for (const im of meshes.buildings) {
      expect(im.material.map).toBeNull();
      expect(im.material.color.getHex()).toBe(new THREE.Color(CONFIG.palette[im.userData.facade]).getHex());
    }
  });

  it('uses the given facade and stripe textures', () => {
    const facades = CONFIG.palette.map(() => new THREE.Texture());
    const stripe = new THREE.Texture();
    const m = buildTownMeshes(town, { facades, stripe });
    for (const im of m.buildings) {
      expect(im.material.map).toBe(facades[im.userData.facade]);
      expect(im.material.color.getHex()).toBe(0xffffff);
    }
    expect(m.walls.material.map).toBe(stripe);
    expect(stripe.repeat.x).toBeGreaterThan(1); // the wall runs for hundreds of metres
  });

  it('matches the town prop counts: caps, lawns, ponds, dashes, trees, lights, walls', () => {
    expect(meshes.caps.count).toBe(town.buildings.length);
    expect(meshes.lawns.count).toBe(town.blocks.filter((b) => b.park).length);
    expect(meshes.ponds.count).toBe(town.ponds.length);
    expect(meshes.dashes.count).toBe(town.dashes.length);
    expect(meshes.trunks.count).toBe(town.trees.length);
    expect(meshes.leaves.count).toBe(town.trees.length);
    expect(meshes.poles.count).toBe(town.lights.length);
    expect(meshes.heads.count).toBe(town.lights.length);
    expect(meshes.walls.count).toBe(4);
  });

  it('sets shadows: props cast, ground covers receive, glowing heads stay flat', () => {
    expect(meshes.caps.castShadow).toBe(true);
    expect(meshes.lawns.receiveShadow).toBe(true);
    expect(meshes.trunks.castShadow).toBe(true);
    expect(meshes.leaves.castShadow).toBe(true);
    expect(meshes.poles.castShadow).toBe(true);
    expect(meshes.walls.castShadow).toBe(true);
    expect(meshes.heads.castShadow).toBe(false);
    expect(meshes.dashes.castShadow).toBe(false);
  });

  it('draws the whole town in fewer than 40 objects', () => {
    expect(drawables(meshes.g)).toBeLessThan(40);
  });

  it('is deterministic: the same town builds the same instances twice', () => {
    expect(snapshot(buildTownMeshes(town))).toEqual(snapshot(meshes));
  });
});
