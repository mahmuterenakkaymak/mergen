// Scene shell: gradient sky dome, horizon-matched fog, hemisphere fill, a warm
// shadowed sun that tracks the car, asphalt ground with grass beyond the town.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const SKY_STOPS = [0, 0.55, 0.78, 1];
const HORIZON = CONFIG.colors.sky[2];
const FOG_NEAR = 140, FOG_FAR = 460;
const SUN_AT = { x: 90, y: 140, z: 60 };
const SHADOW_EXTENT = 90;
// The town owns 0..WORLD in x/z, so a ground plane centred on the origin has to
// span twice that to keep the whole town on asphalt.
const WORLD = CONFIG.grid * (CONFIG.block + CONFIG.road);
const ASPHALT_SIZE = 2 * (WORLD + 60);
const GRASS_SIZE = 2400;

function skyTexture() {
  if (typeof document === 'undefined') return null; // headless: dome falls back to a flat horizon colour
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  CONFIG.colors.sky.forEach((col, i) => gr.addColorStop(SKY_STOPS[i], col));
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createScene() {
  const scene = new THREE.Scene();
  // ASSUMPTION: colors.fog is the hand-tuned horizon haze, so distant geometry
  // melts into the pale band the sky gradient shows at eye level.
  scene.fog = new THREE.Fog(CONFIG.colors.fog, FOG_NEAR, FOG_FAR);

  const map = skyTexture();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : HORIZON, side: THREE.BackSide, fog: false })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(CONFIG.colors.hemiSky, CONFIG.colors.hemiGround, 0.85);
  const sun = new THREE.DirectionalLight(CONFIG.colors.sun, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 400;
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT,
  });
  sun.shadow.bias = -0.0006;
  scene.add(hemi, sun, sun.target);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(ASPHALT_SIZE, ASPHALT_SIZE),
    new THREE.MeshLambertMaterial({ color: CONFIG.colors.asphalt })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(GRASS_SIZE, GRASS_SIZE),
    new THREE.MeshLambertMaterial({ color: CONFIG.colors.grass })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  scene.add(asphalt, grass);

  scene.userData.sun = sun;
  return { scene, sky, hemi, sun, asphalt, grass };
}

// Keeps the shadow box centred on the car without moving the light direction.
export function followSun(scene, target) {
  const sun = scene.userData.sun;
  sun.position.set(target.x + SUN_AT.x, SUN_AT.y, target.z + SUN_AT.z);
  sun.target.position.set(target.x, 0, target.z);
}
