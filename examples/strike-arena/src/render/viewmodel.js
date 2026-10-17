// First-person weapon visuals: three procedural guns assembled from boxes and
// cylinders, so the game ships with zero model files. Each group carries a named
// 'muzzle' Object3D at the end of its barrel — effects.js spawns flashes and tracers
// from that transform, so the muzzle is an API contract, not decoration.
//
// Convention: the camera looks down -Z, so every gun points -Z with its muzzle at a
// negative z. A group is meant to be parented to the camera, which is why the local
// offsets below are in view space (right / down / forward).
import * as THREE from 'three';

// View-space placement shared by all three guns.
const MOUNT = { x: 0.18, y: -0.18, z: -0.42 };

// Reload pose: the magazine drops out and comes back while the gun tilts down, both
// following a single sin(progress*PI) envelope so the pose starts and ends at rest.
const MAG_DROP = 0.14; // meters the magazine falls
const RELOAD_TILT = 0.55; // radians of pitch at the peak of the animation

const COLORS = {
  body: 0x2b2f33,
  steel: 0x8b9299,
  darkSteel: 0x5a6067,
  grip: 0x3d2f23,
  magazine: 0x3a4046,
  scope: 0x1c1f22,
  lens: 0x4fa3d1,
};

function mesh(group, geo, color, pos, name) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(pos[0], pos[1], pos[2]);
  if (name) m.name = name;
  group.add(m);
  return m;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

// The muzzle is an empty transform: effects read its world position, nothing renders it.
function muzzleAt(group, z) {
  const m = new THREE.Object3D();
  m.name = 'muzzle';
  m.position.set(0, 0, z);
  group.add(m);
  return m;
}

// Remembers where the magazine started so the reload pose can be reset exactly.
function registerMag(group, mag) {
  mag.name = 'mag';
  group.userData.mag = mag;
  group.userData.magBaseY = mag.position.y;
  return mag;
}

function buildPistol() {
  const g = new THREE.Group();
  g.name = 'viewmodel_pistol';

  mesh(g, box(0.07, 0.07, 0.26), COLORS.body, [0, 0.02, -0.05], 'slide');
  mesh(g, new THREE.CylinderGeometry(0.017, 0.017, 0.1, 12), COLORS.steel, [0, 0.02, -0.2], 'barrel').rotation.x =
    Math.PI / 2;
  const grip = mesh(g, box(0.06, 0.16, 0.08), COLORS.grip, [0, -0.09, 0.05], 'grip');
  grip.rotation.x = -0.25;
  registerMag(g, mesh(g, box(0.045, 0.1, 0.055), COLORS.magazine, [0, -0.06, 0.05], 'mag'));

  muzzleAt(g, -0.25);
  return g;
}

function buildRifle() {
  const g = new THREE.Group();
  g.name = 'viewmodel_rifle';

  mesh(g, box(0.07, 0.08, 0.3), COLORS.body, [0, 0.01, -0.02], 'receiver');
  mesh(g, box(0.06, 0.09, 0.16), COLORS.grip, [0, 0.0, 0.19], 'stock');
  mesh(g, new THREE.CylinderGeometry(0.019, 0.019, 0.3, 12), COLORS.darkSteel, [0, 0.02, -0.3], 'barrel').rotation.x =
    Math.PI / 2;
  mesh(g, box(0.05, 0.05, 0.12), COLORS.steel, [0, 0.06, -0.12], 'handguard');
  mesh(g, box(0.05, 0.15, 0.06), COLORS.grip, [0, -0.1, 0.02], 'pistolGrip');
  registerMag(g, mesh(g, box(0.045, 0.17, 0.06), COLORS.magazine, [0, -0.11, -0.05], 'mag'));

  muzzleAt(g, -0.45);
  return g;
}

function buildSniper() {
  const g = new THREE.Group();
  g.name = 'viewmodel_sniper';

  mesh(g, box(0.07, 0.08, 0.34), COLORS.body, [0, 0.0, 0.0], 'receiver');
  mesh(g, box(0.06, 0.1, 0.2), COLORS.grip, [0, 0.0, 0.26], 'stock');
  mesh(g, new THREE.CylinderGeometry(0.016, 0.016, 0.5, 12), COLORS.darkSteel, [0, 0.02, -0.36], 'barrel')
    .rotation.x = Math.PI / 2;
  const scope = mesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12), COLORS.scope, [0, 0.09, -0.04], 'scope');
  scope.rotation.x = Math.PI / 2;
  mesh(g, new THREE.SphereGeometry(0.026, 12, 8), COLORS.lens, [0, 0.09, 0.07], 'lens');
  registerMag(g, mesh(g, box(0.05, 0.1, 0.07), COLORS.magazine, [0, -0.08, -0.02], 'mag'));

  muzzleAt(g, -0.61);
  return g;
}

const BUILDERS = { pistol: buildPistol, rifle: buildRifle, sniper: buildSniper };

// Builds the three viewmodels and the small state API the renderer drives each frame:
// setActive picks which gun is up, setReload poses a gun for a reload in progress.
export function createViewmodels() {
  const root = new THREE.Group();
  root.name = 'viewmodels';

  const groups = {};
  for (const [name, build] of Object.entries(BUILDERS)) {
    groups[name] = build();
    groups[name].position.set(MOUNT.x, MOUNT.y, MOUNT.z);
    root.add(groups[name]);
  }

  const vm = {
    ...groups,

    root,
    active: null,

    // Only the active gun renders; the others stay in the scene graph (already built,
    // cheap) so switching is a visibility flip rather than a rebuild.
    setActive(name) {
      if (!(name in groups)) {
        throw new Error(`createViewmodels: unknown weapon "${name}"`);
      }
      vm.active = name;
      for (const [key, group] of Object.entries(groups)) {
        group.visible = key === name;
      }
      return groups[name];
    },

    // progress 0..1 through the weapon's reloadTime. The pose is a pure function of
    // progress, so callers can scrub it and 0 always returns the gun to rest.
    setReload(name, progress) {
      const group = groups[name];
      if (!group) throw new Error(`createViewmodels: unknown weapon "${name}"`);

      const p = Math.min(1, Math.max(0, progress));
      const swing = Math.sin(p * Math.PI);
      const mag = group.userData.mag;
      if (mag) mag.position.y = group.userData.magBaseY - swing * MAG_DROP;
      group.rotation.x = swing * RELOAD_TILT;
      return swing;
    },
  };

  vm.setActive('pistol');
  return vm;
}

export default createViewmodels;
