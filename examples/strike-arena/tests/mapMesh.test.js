import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildArena } from '../src/render/mapMesh.js';
import MAP_DATA, { getColliders } from '../src/core/mapData.js';
import { CONFIG } from '../src/config.js';

// Each source box stamps a boxId into its vertices; distinct ids per mesh = boxes.
function countBoxes(group) {
  let total = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const attr = o.geometry.getAttribute('boxId');
    expect(attr, `${o.name} has a boxId attribute`).toBeTruthy();
    total += new Set(attr.array).size;
  });
  return total;
}

describe('buildArena', () => {
  const arena = buildArena(MAP_DATA);

  it('returns a THREE.Group', () => {
    expect(arena).toBeInstanceOf(THREE.Group);
  });

  it('merges the arena into at most CONFIG.MAP.maxMeshes meshes', () => {
    const meshes = arena.children.filter((c) => c.isMesh);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(CONFIG.MAP.maxMeshes);
  });

  it('draws exactly one box per collider', () => {
    expect(countBoxes(arena)).toBe(getColliders().length);
  });

  it('colors every mesh through vertex colors', () => {
    const meshes = arena.children.filter((c) => c.isMesh);
    for (const mesh of meshes) {
      expect(mesh.material.vertexColors).toBe(true);
      expect(mesh.geometry.getAttribute('color')).toBeTruthy();
    }
  });

  it('paints a checker pattern on the floor', () => {
    const floor = arena.children.find((c) => c.name === 'arena_floor');
    expect(floor).toBeTruthy();
    const arr = floor.geometry.getAttribute('color').array;
    const shades = new Set();
    for (let i = 0; i < arr.length; i += 3) {
      shades.add(`${arr[i].toFixed(3)},${arr[i + 1].toFixed(3)},${arr[i + 2].toFixed(3)}`);
    }
    expect(shades.size).toBeGreaterThanOrEqual(2);
  });

  it('lights the arena with ambient, hemisphere and directional lights', () => {
    const kinds = arena.children.filter((c) => c.isLight).map((c) => c.type);
    expect(kinds).toContain('AmbientLight');
    expect(kinds).toContain('HemisphereLight');
    expect(kinds).toContain('DirectionalLight');
  });
});
