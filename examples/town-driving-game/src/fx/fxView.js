// FX views: the particle pool drawn as one Points cloud (per-vertex colour, no depth
// write so overlapping sparks and smoke blend), and the skid pool as one translucent
// InstancedMesh of road quads floating just above the asphalt. Thin views over the pure
// pools — they read the pools each frame and write nothing back.
import * as THREE from 'three';

const PARTICLE_SIZE = 0.22; // m, world-space (sizeAttenuation)
const SKID_W = 0.34; // m across a tyre mark
const SKID_L = 1.1;  // m along it; consecutive quads overlap into a continuous line
const SKID_Y = 0.012; // just above the asphalt (0), below the centre-line dashes (0.02)
const SKID_COLOR = 0x14161a;
const SKID_OPACITY = 0.32;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

export function buildFxView(particles, skids) {
  const g = new THREE.Group();

  // Particles: the pool's Float32Arrays seed the buffers; sync refreshes them each frame.
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(particles.pos.slice(), 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(particles.col.slice(), 3));
  const points = new THREE.Points(pgeo, new THREE.PointsMaterial({
    size: PARTICLE_SIZE,
    vertexColors: true,
    transparent: true,
    depthWrite: false, // sparks and smoke blend instead of punching holes in each other
  }));
  points.frustumCulled = false; // positions move every frame; a stale bounding sphere would cull them
  g.add(points);

  // Skids: one road quad per pool slot, drawn only up to the slots the pool has filled.
  const quad = new THREE.PlaneGeometry(SKID_W, SKID_L).rotateX(-Math.PI / 2);
  const skidMesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
    color: SKID_COLOR,
    transparent: true,
    opacity: SKID_OPACITY,
    depthWrite: false,
  }), skids.capacity);
  skidMesh.count = skids.count;
  skidMesh.frustumCulled = false; // marks are scattered across the whole town
  g.add(skidMesh);

  return { g, points, skidMesh };
}

// Copy the pool's live positions and colours into the Points buffers for re-upload.
export function syncParticles(view, particles) {
  const attr = view.points.geometry.attributes;
  attr.position.array.set(particles.pos);
  attr.color.array.set(particles.col);
  attr.position.needsUpdate = true;
  attr.color.needsUpdate = true;
}

// Compose one instance matrix per filled skid slot: flat on the road, aligned to the
// heading the mark was laid down at, and only as many instances as the pool holds.
export function syncSkids(view, skids) {
  const mesh = view.skidMesh;
  for (let i = 0; i < skids.count; i++) {
    Q.setFromEuler(E.set(0, skids.heading[i], 0));
    M.compose(P.set(skids.x[i], SKID_Y, skids.z[i]), Q, ONE);
    mesh.setMatrixAt(i, M);
  }
  mesh.count = skids.count;
  mesh.instanceMatrix.needsUpdate = true;
}
