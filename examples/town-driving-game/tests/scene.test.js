import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createScene, followSun } from '../src/render/scene.js';
import { CONFIG } from '../src/config.js';

const light = (scene, Ctor) => scene.children.find((c) => c instanceof Ctor);
const chan = (hex, shift) => (hex >> shift) & 255;

describe('createScene', () => {
  const { scene, sky, asphalt, grass } = createScene();

  it('fogs the distance in the horizon tone', () => {
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(scene.fog.color.getHex()).toBe(CONFIG.colors.fog);
    expect(scene.fog.near).toBeGreaterThan(0);
    expect(scene.fog.near).toBeLessThan(scene.fog.far);
    // matched: the fog sits on the pale band the sky gradient shows at eye level
    const horizon = new THREE.Color(CONFIG.colors.sky[2]).getHex();
    for (const s of [16, 8, 0]) {
      expect(Math.abs(chan(CONFIG.colors.fog, s) - chan(horizon, s))).toBeLessThan(32);
    }
  });

  it('fills with a hemisphere light and lights with a warm shadowed sun', () => {
    const hemi = light(scene, THREE.HemisphereLight);
    expect(hemi.color.getHex()).toBe(CONFIG.colors.hemiSky);
    expect(hemi.groundColor.getHex()).toBe(CONFIG.colors.hemiGround);
    expect(hemi.intensity).toBeGreaterThan(0);

    const sun = light(scene, THREE.DirectionalLight);
    expect(sun.color.getHex()).toBe(CONFIG.colors.sun);
    expect(sun.color.r).toBeGreaterThan(sun.color.b); // warm
    expect(sun.castShadow).toBe(true);
    expect([sun.shadow.mapSize.x, sun.shadow.mapSize.y]).toEqual([2048, 2048]);
    expect(sun.shadow.camera.right).toBeGreaterThan(40); // box wide enough for a block
    expect(sun.shadow.camera.far).toBeGreaterThan(sun.shadow.camera.near);
    expect(scene.children).toContain(sun.target); // target must be in the graph to aim the light
  });

  it('builds a sky dome and skips the canvas texture when there is no document', () => {
    expect(sky.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(sky.material.side).toBe(THREE.BackSide);
    expect(sky.material.fog).toBe(false);
    expect(sky.renderOrder).toBe(-1);
    // Vitest runs in Node: the dome must still read as sky, in the flat horizon colour
    expect(sky.material.map).toBeNull();
    expect(sky.material.color.getHex()).toBe(new THREE.Color(CONFIG.colors.sky[2]).getHex());
  });

  it('lays asphalt under the town with grass beyond it', () => {
    expect(asphalt.rotation.x).toBeCloseTo(-Math.PI / 2, 9);
    expect(asphalt.receiveShadow).toBe(true);
    expect(asphalt.material.color.getHex()).toBe(CONFIG.colors.asphalt);
    expect(grass.material.color.getHex()).toBe(CONFIG.colors.grass);
    expect(grass.position.y).toBeLessThan(asphalt.position.y);
    expect(grass.geometry.parameters.width).toBeGreaterThan(asphalt.geometry.parameters.width);
    const townEdge = CONFIG.grid * (CONFIG.block + CONFIG.road) + CONFIG.road;
    expect(asphalt.geometry.parameters.width / 2).toBeGreaterThan(townEdge);
  });
});

describe('followSun', () => {
  it('carries the shadow box with the target at a fixed light direction', () => {
    const { scene, sun } = createScene();
    followSun(scene, { x: 0, z: 0 });
    const p0 = sun.position.clone();
    expect(sun.position.y).toBeGreaterThan(60);
    expect(sun.target.position.y).toBe(0);

    followSun(scene, { x: 120, z: -40 });
    expect(sun.position.x - p0.x).toBeCloseTo(120, 6);
    expect(sun.position.z - p0.z).toBeCloseTo(-40, 6);
    expect(sun.position.y).toBeCloseTo(p0.y, 9); // same altitude -> shadow angle never changes
    expect(sun.target.position.x).toBe(120);
    expect(sun.target.position.z).toBe(-40);
  });
});
