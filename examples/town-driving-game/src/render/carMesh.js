// Car view model: metallic body, dark glass cabin, bumpers, lights,
// 4 wheels with the front pair on steer pivots. Thin view over sim car state.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const WHEEL_R = 0.42;
const TAIL_OFF = 0x8a1010;
const TAIL_ON = 0xff2020;
const BEAM_W = 7, BEAM_L = 16, BEAM_Z = 9; // m of road the parked car's lamps wash
const BEAM_COLOR = 0xffc46a;

export function buildCarMesh(color = CONFIG.colors.carBody) {
  const g = new THREE.Group();
  // Everything sprung (body, cabin, bumpers, lamps) hangs on one chassis group so it leans as
  // one piece; wheels and the road beam stay on g, on the ground.
  const chassis = new THREE.Group(); g.add(chassis);
  const box = new THREE.BoxGeometry(1, 1, 1);

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
  const body = new THREE.Mesh(box, bodyMat);
  body.scale.set(1.9, 0.55, 4.2); body.position.y = 0.62; body.castShadow = true; chassis.add(body);

  const cabin = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x141a22, metalness: 0.8, roughness: 0.15 }));
  cabin.scale.set(1.6, 0.5, 2.0); cabin.position.set(0, 1.12, -0.25); cabin.castShadow = true; chassis.add(cabin);

  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8 });
  for (const z of [2.05, -2.05]) {
    const b = new THREE.Mesh(box, bumperMat);
    b.scale.set(1.9, 0.3, 0.25); b.position.set(0, 0.45, z); chassis.add(b);
  }

  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: TAIL_OFF });
  for (const x of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(box, headMat); hl.scale.set(0.4, 0.18, 0.08); hl.position.set(x, 0.72, 2.11); chassis.add(hl);
    const tl = new THREE.Mesh(box, tailMat); tl.scale.set(0.42, 0.16, 0.08); tl.position.set(x, 0.72, -2.11); chassis.add(tl);
  }

  // The car's own lamps for the dusk attract shot, washed on the road ahead of it. A quad
  // rather than a SpotLight: the asphalt is a single quad and two more dynamic lights would
  // re-shade every material in the scene for a glow the start screen hides a second later.
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(BEAM_W, BEAM_L), new THREE.MeshBasicMaterial({
    color: BEAM_COLOR, map: makeBeamTexture(), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.02, BEAM_Z);
  beam.visible = false;
  g.add(beam);

  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 });
  const wheels = [], steers = [];
  for (const [x, z, front] of [[-0.95, 1.35, 1], [0.95, 1.35, 1], [-0.95, -1.35, 0], [0.95, -1.35, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, WHEEL_R, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.castShadow = true; pivot.add(w);
    g.add(pivot); wheels.push(w); if (front) steers.push(pivot);
  }

  return { g, chassis, body, cabin, bodyMat, wheels, steers, tailMat, beam, lamps: false, baseColor: new THREE.Color(color) };
}

// The parked car lights its own lamps so it reads as "yours, ready to go" in the dusk
// attract shot: glowing tail lights and the warm pool on the road. The flag, not a one-off
// colour write, is what holds the glow — updateCarMesh runs every frame and would undo it.
export function setLamps(mesh, on) {
  mesh.lamps = on;
  mesh.beam.visible = on;
  mesh.tailMat.color.setHex(on ? TAIL_ON : TAIL_OFF);
}

export function updateCarMesh(mesh, car, dt) {
  mesh.g.position.set(car.x, 0, car.z);
  mesh.g.rotation.y = car.heading;
  // Weight transfer: the whole chassis leans on its springs, the wheels stay down.
  // Traffic cars carry no lean state; 0 keeps their bodies from going NaN and vanishing.
  mesh.chassis.rotation.x = car.pitch || 0;
  mesh.chassis.rotation.z = car.roll || 0;
  const spin = (car.speed / WHEEL_R) * dt;
  for (const w of mesh.wheels) w.rotation.x += spin;
  for (const s of mesh.steers) s.rotation.y = car.steer;
  // ASSUMPTION: braking/damage are not on the sim car; the game view layer sets them (falsy/0 when absent).
  mesh.tailMat.color.setHex(car.braking || mesh.lamps ? TAIL_ON : TAIL_OFF);
  const tint = 1 - Math.min(100, car.damage || 0) / 220;
  mesh.bodyMat.color.copy(mesh.baseColor).multiplyScalar(tint);
}

// The ramp is the whole shape of the pool: soft edges, no lens detail. The quad lies flat
// with its top edge at the car, so the hot spot is painted above the canvas centre — a few
// metres of road ahead of the lamps, fading out from there.
function makeBeamTexture() {
  if (typeof document === 'undefined') return null; // headless: the pool is never rendered
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 56, 6, 64, 56, 150);
  gr.addColorStop(0, 'rgba(255,255,255,0.65)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.2)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
