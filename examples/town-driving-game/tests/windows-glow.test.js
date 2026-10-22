import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildTownMeshes } from '../src/render/townMeshes.js';
import { generateTown } from '../src/town.js';
import { CONFIG } from '../src/config.js';

// The lit windows are painted into the facade texture; the building material has to
// emit that same texture or they render as pale smudges instead of glowing windows.
const town = generateTown();
const facades = CONFIG.palette.map(() => new THREE.Texture());
const meshes = buildTownMeshes(town, { facades });

const buildingMaterials = (g) => {
  const mats = [];
  g.traverse((o) => { if (o.isInstancedMesh && o.userData.facade !== undefined) mats.push(o.material); });
  return mats;
};

describe('lit windows glow (T64)', () => {
  it('gives every building material in the group an emissive map that is lit', () => {
    const mats = buildingMaterials(meshes.g);
    expect(mats.length).toBeGreaterThan(0);
    for (const mat of mats) {
      expect(mat.emissiveMap).not.toBeNull();
      expect(mat.emissive.getHex()).toBe(0xffffff);
      expect(mat.emissiveIntensity).toBeGreaterThan(0);
    }
  });

  it('emits the facade texture itself, so the painted windows are what glow', () => {
    for (const im of meshes.buildings) {
      expect(im.material.emissiveMap).toBe(facades[im.userData.facade]);
    }
  });
});
