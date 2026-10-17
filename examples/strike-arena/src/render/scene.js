// Scene assembly: sky color + fog from CONFIG.MAP, the merged arena group and the
// first-person camera. Rotation order YXZ keeps yaw on the world Y axis and pitch on
// the camera's local X, which is exactly the yaw/pitch pair core/movement.js tracks.
import * as THREE from 'three';
import { MAP } from '../config.js';
import MAP_DATA, { getColliders } from '../core/mapData.js';
import { buildArena } from './mapMesh.js';

const NEAR = 0.05; // close enough that a crate edge at the screen border is not clipped
const FAR = 220; // past MAP.fogFar, so geometry never pops in out of the fog
const FALLBACK_ASPECT = 16 / 9; // headless / no-viewport fallback

function viewportAspect() {
  if (typeof window === 'undefined') return FALLBACK_ASPECT;
  return window.innerWidth > 0 && window.innerHeight > 0
    ? window.innerWidth / window.innerHeight
    : FALLBACK_ASPECT;
}

export function createScene(mapData = MAP_DATA, colliders = getColliders()) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MAP.skyColor);
  scene.fog = new THREE.Fog(MAP.skyColor, MAP.fogNear, MAP.fogFar);

  const camera = new THREE.PerspectiveCamera(MAP.fov, viewportAspect(), NEAR, FAR);
  camera.rotation.order = 'YXZ';

  const arena = buildArena(mapData, colliders);
  scene.add(arena);

  return { scene, camera, arena };
}

export default createScene;
