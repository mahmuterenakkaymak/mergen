import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../src/render/scene.js';
import MAP_DATA, { getColliders } from '../src/core/mapData.js';
import { CONFIG } from '../src/config.js';

describe('createScene', () => {
  const { scene, camera, arena } = createScene(MAP_DATA, getColliders());

  it('returns a scene with the arena group attached', () => {
    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(arena).toBeInstanceOf(THREE.Group);
    expect(arena.parent).toBe(scene);
    expect(scene.getObjectByName('arena')).toBe(arena);
  });

  it('creates a PerspectiveCamera with the config fov', () => {
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(camera.fov).toBe(CONFIG.MAP.fov);
    expect(camera.aspect).toBeGreaterThan(0);
    expect(camera.near).toBeLessThan(camera.far);
  });

  it('orders camera rotation YXZ so yaw stays world-vertical', () => {
    expect(camera.rotation.order).toBe('YXZ');
  });

  it('fogs and clears to the sky color', () => {
    const sky = new THREE.Color(CONFIG.MAP.skyColor);
    expect(scene.background.isColor).toBe(true);
    expect(scene.background.equals(sky)).toBe(true);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(scene.fog.near).toBe(CONFIG.MAP.fogNear);
    expect(scene.fog.far).toBe(CONFIG.MAP.fogFar);
    expect(scene.fog.color.equals(sky)).toBe(true);
  });

  it('keeps the near plane below the player collision box', () => {
    expect(camera.near).toBeLessThan(CONFIG.MOVEMENT.playerWidth / 2);
  });
});
