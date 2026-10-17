// Arena visuals: every collider box becomes exactly one visual box, merged into a
// single mesh per material so the whole map costs a handful of draw calls. Color
// lives in vertex colors (one material per category, subtle deterministic per-box
// tint); the floor is a procedural checker painted onto the floor slab's top face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP } from '../config.js';
import MAP_DATA, { getColliders } from '../core/mapData.js';

// Lighting is fixed for the whole arena (scene.js owns the camera, not the lights),
// so its few tunables live here until a config section needs them.
const AMBIENT_INTENSITY = 0.35;
const HEMI_INTENSITY = 0.55;
const SUN_INTENSITY = 1.1;
const SUN_POSITION = [25, 40, 15];

const CHECKER_CELL = 1.5; // meters per floor tile
const CHECKER_DARK = 0.7; // fraction of floorColor for the dark tiles
const FLOOR_SIDE = 0.45; // fraction of floorColor for the slab sides
const TINT_RANGE = 0.08; // +/- fraction of per-box brightness variation

const BASE_COLORS = {
  walls: new THREE.Color(MAP.wallColor),
  crates: new THREE.Color(MAP.crateColor),
  trim: new THREE.Color(MAP.trimColor),
};

// Deterministic per-box brightness jitter from the box coordinates, so two builds
// of the same arena look identical without carrying RNG state into rendering.
function boxTint(box) {
  const key = `${box.min.x}|${box.min.y}|${box.min.z}|${box.max.x}|${box.max.y}|${box.max.z}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1 - TINT_RANGE + (((h >>> 0) % 1000) / 999) * 2 * TINT_RANGE;
}

// Which visual category a collider belongs to, from its shape alone: the floor
// slab sits at or below the bounds floor, crates are shorter than the walls, and
// a full-height box that fits strictly inside the bounds is a divider (trim).
function categorize(box, mapData) {
  const b = mapData.bounds;
  if (box.max.y <= b.min.y + 1e-9) return 'floor';
  if (box.max.y - box.min.y < b.max.y - b.min.y - 1e-6) return 'crates';
  const inside =
    box.min.x > b.min.x && box.max.x < b.max.x && box.min.z > b.min.z && box.max.z < b.max.z;
  return inside ? 'trim' : 'walls';
}

function boxSize(box) {
  return new THREE.Vector3().subVectors(box.max, box.min);
}

function boxCenter(box) {
  return new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
}

function fillColor(geo, color) {
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// boxId lets a mesh's source-box count be read back from the merged geometry
// (distinct ids), which is how the tests tie the visuals to the collider list.
function addBoxId(geo, id) {
  const n = geo.attributes.position.count;
  geo.setAttribute('boxId', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  return geo;
}

function tintedBoxGeometry(box, baseColor, id) {
  const size = boxSize(box);
  const center = boxCenter(box);
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
  geo.translate(center.x, center.y, center.z);
  fillColor(geo, baseColor.clone().multiplyScalar(boxTint(box)));
  return addBoxId(geo, id);
}

// One subdivided slab: the top face is colored tile by tile (checker), the sides
// stay dark so the arena reads as a floor plane with thickness.
function floorGeometry(box, id) {
  const size = boxSize(box);
  const center = boxCenter(box);
  const segX = Math.max(1, Math.round(size.x / CHECKER_CELL));
  const segZ = Math.max(1, Math.round(size.z / CHECKER_CELL));
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z, segX, 1, segZ).toNonIndexed();
  geo.translate(center.x, center.y, center.z);

  const light = new THREE.Color(MAP.floorColor);
  const dark = light.clone().multiplyScalar(CHECKER_DARK);
  const side = light.clone().multiplyScalar(FLOOR_SIDE);

  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  for (let t = 0; t < pos.count; t += 3) {
    let c = side;
    if ((nor.getY(t) + nor.getY(t + 1) + nor.getY(t + 2)) / 3 > 0.5) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const cellX = Math.floor((cx - box.min.x) / CHECKER_CELL);
      const cellZ = Math.floor((cz - box.min.z) / CHECKER_CELL);
      c = (cellX + cellZ) % 2 === 0 ? light : dark;
    }
    for (let v = t; v < t + 3; v++) {
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return addBoxId(geo, id);
}

export function buildArena(mapData = MAP_DATA, colliders = getColliders()) {
  const group = new THREE.Group();
  group.name = 'arena';

  const buckets = { floor: [], walls: [], crates: [], trim: [] };
  const nextId = { floor: 0, walls: 0, crates: 0, trim: 0 };
  for (const box of colliders) {
    const cat = categorize(box, mapData);
    const id = nextId[cat]++;
    buckets[cat].push(
      cat === 'floor' ? floorGeometry(box, id) : tintedBoxGeometry(box, BASE_COLORS[cat], id),
    );
  }

  for (const [cat, geos] of Object.entries(buckets)) {
    if (geos.length === 0) continue;
    const mesh = new THREE.Mesh(
      mergeGeometries(geos, false),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    mesh.name = `arena_${cat}`;
    mesh.castShadow = MAP.shadows;
    mesh.receiveShadow = MAP.shadows;
    group.add(mesh);
  }

  const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2e2a20, HEMI_INTENSITY);
  const sun = new THREE.DirectionalLight(0xfff3e0, SUN_INTENSITY);
  sun.position.set(...SUN_POSITION);
  sun.castShadow = MAP.shadows;
  group.add(ambient, hemi, sun);

  return group;
}

export default buildArena;
