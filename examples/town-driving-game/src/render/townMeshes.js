// Town view: every static prop is instanced — sidewalk slabs, buildings (one
// InstancedMesh per facade texture), roof caps, park lawns, ponds, road dashes,
// trees, streetlights and the striped perimeter wall — so the whole town draws
// in a couple of dozen calls instead of hundreds of separate meshes.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const SLAB_H = 0.16; // sidewalk slab height; buildings, trees and lawns sit on top
const CAP_H = 0.4;   // roof cap thickness
const WALL_T = 0.8;  // perimeter wall thickness (m)
const STRIPE_M = 8;  // one stripe texture tile spans this many metres of wall
const DASH_Y = 0.02; // centre-line marks float just above the asphalt
const WINDOW_GLOW = 0.5; // how strongly the lit windows painted in a facade texture emit

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const IDENT = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();

// ASSUMPTION: the town carries no rng for decoration, so tree size varies with a
// position hash — the same layout looks the same on every run.
function hashScale(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return 0.8 + 0.7 * (s - Math.floor(s));
}

function setBox(m, x, y, z, sx, sy, sz, rot = 0) {
  m.compose(P.set(x, y, z), rot ? Q.setFromEuler(E.set(0, rot, 0)) : IDENT, S.set(sx, sy, sz));
}

function instanced(geo, mat, items, place) {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  for (let k = 0; k < items.length; k++) { place(M, items[k]); im.setMatrixAt(k, M); }
  im.computeBoundingSphere();
  return im;
}

export function buildTownMeshes(town, textures = {}) {
  const g = new THREE.Group();
  const add = (im, cast = false, receive = false) => {
    if (!im) return im;
    im.castShadow = cast;
    im.receiveShadow = receive;
    g.add(im);
    return im;
  };
  const lambert = (color, map = null) =>
    new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : color });

  const unit = new THREE.BoxGeometry(1, 1, 1);

  const sidewalks = add(instanced(unit, new THREE.MeshLambertMaterial({ color: CONFIG.colors.sidewalk }),
    town.blocks, (m, b) => setBox(m, b.x + b.w / 2, SLAB_H / 2, b.z + b.h / 2, b.w, SLAB_H, b.h)), false, true);

  // One InstancedMesh per facade texture; without a canvas texture the building
  // keeps its flat palette colour.
  const byFacade = new Map();
  for (const b of town.buildings) {
    if (!byFacade.has(b.facade)) byFacade.set(b.facade, []);
    byFacade.get(b.facade).push(b);
  }
  const buildings = [];
  for (const [fi, list] of byFacade) {
    const facade = textures.facades?.[fi] ?? null;
    // The lit windows live in the facade texture; feeding the same map to emissive
    // makes them glow, so the town reads as inhabited behind the start screen/at dusk.
    const mat = new THREE.MeshLambertMaterial({
      map: facade,
      color: facade ? 0xffffff : CONFIG.palette[fi],
      emissive: facade ? 0xffffff : 0x000000,
      emissiveMap: facade,
      emissiveIntensity: WINDOW_GLOW,
    });
    const im = instanced(unit, mat, list,
      (m, b) => setBox(m, b.x + b.w / 2, SLAB_H + b.height / 2, b.z + b.d / 2, b.w, b.height, b.d));
    im.userData.facade = fi;
    buildings.push(add(im, true, true));
  }

  const caps = add(instanced(unit, new THREE.MeshLambertMaterial({ color: CONFIG.colors.roofCap }),
    town.buildings, (m, b) => setBox(m, b.x + b.w / 2, SLAB_H + b.height + 0.1, b.z + b.d / 2, b.w + 0.5, CAP_H, b.d + 0.5)), true);

  const lawns = add(instanced(unit, new THREE.MeshLambertMaterial({ color: CONFIG.colors.lawn }),
    town.blocks.filter((b) => b.park), (m, b) => setBox(m, b.x + b.w / 2, 0.18, b.z + b.h / 2, b.w - 4, 0.06, b.h - 4)), false, true);

  const pondGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const ponds = add(instanced(pondGeo, new THREE.MeshLambertMaterial({ color: CONFIG.colors.pond }),
    town.ponds, (m, p) => setBox(m, p.x, 0.22, p.z, p.r, 1, p.r)));

  const dashGeo = new THREE.PlaneGeometry(0.28, 2.4).rotateX(-Math.PI / 2);
  const dashes = add(instanced(dashGeo, new THREE.MeshBasicMaterial({ color: CONFIG.colors.dash }),
    town.dashes, (m, d) => setBox(m, d.x, DASH_Y, d.z, 1, 1, 1, d.rot)));

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6);
  const leafGeo = new THREE.ConeGeometry(1.9, 4.4, 7);
  const trunks = add(instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: CONFIG.colors.trunk }),
    town.trees, (m, t) => { const s = hashScale(t.x, t.z); setBox(m, t.x, SLAB_H + 1.1 * s, t.z, s, s, s); }), true);
  const leaves = add(instanced(leafGeo, new THREE.MeshLambertMaterial({ color: CONFIG.colors.leaf }),
    town.trees, (m, t) => { const s = hashScale(t.x, t.z); setBox(m, t.x, SLAB_H + 4.4 * s, t.z, s, s, s); }), true);

  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
  const headGeo = new THREE.SphereGeometry(0.28, 8, 8);
  const poles = add(instanced(poleGeo, new THREE.MeshLambertMaterial({ color: CONFIG.colors.pole }),
    town.lights, (m, l) => setBox(m, l.x, 2.7, l.z, 1, 1, 1)), true);
  const heads = add(instanced(headGeo, new THREE.MeshBasicMaterial({ color: CONFIG.colors.lamp }),
    town.lights, (m, l) => setBox(m, l.x, 5.5, l.z, 1, 1, 1)));

  const { minX, maxX, minZ, maxZ } = town.bounds;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const spanX = maxX - minX + WALL_T, spanZ = maxZ - minZ + WALL_T;
  const stripe = textures.stripe ?? null;
  // ASSUMPTION: the town is square, so one repeat value tiles the stripes evenly
  // along every side.
  if (stripe) stripe.repeat.x = Math.max(spanX, spanZ) / STRIPE_M;
  const walls = add(instanced(unit, lambert(CONFIG.colors.wallStripe[0], stripe),
    [[cx, minZ, spanX, WALL_T], [cx, maxZ, spanX, WALL_T],
     [minX, cz, WALL_T, spanZ], [maxX, cz, WALL_T, spanZ]],
    (m, [x, z, sx, sz]) => setBox(m, x, CONFIG.wall / 2, z, sx, CONFIG.wall, sz)), true);

  return { g, sidewalks, buildings, caps, lawns, ponds, dashes, trunks, leaves, poles, heads, walls };
}
