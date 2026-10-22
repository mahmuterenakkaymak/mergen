// Actor views: pedestrians as small capsule figures — torso, head, two legs hinged at the
// hip — that swing and bob on the sim's walk phase, and the AI traffic as a pool of car
// views in the colours the sim picked. Thin views: they read sim state each frame and
// write nothing back.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildCarMesh, updateCarMesh } from './carMesh.js';

const TORSO_R = 0.19, TORSO_L = 0.42; // m: capsule radius and its straight part
const TORSO_Y = 1.18; // m: capsule centre, putting the head just under 1.9 m
const HEAD_R = 0.15;
const HEAD_Y = TORSO_Y + TORSO_L / 2 + TORSO_R + HEAD_R - 0.05;
const HIP_Y = 0.78; // m: legs hang from here to the pavement
const HIP_X = 0.11; // m: how far apart the two legs are
const LEG_W = 0.15;
const SWING = 0.55; // rad: how far a leg reaches forward and back
const BOB = 0.05; // m: how much the body rides up at mid-stride
const HEAD_COLOR = 0xd9cfc2; // a neutral head, so the shirt colour carries the walker
const LEG_COLOR = 0x2b2f36;

export function buildPedMesh(color = CONFIG.colors.peds[0]) {
  const g = new THREE.Group();
  const cloth = { metalness: 0, roughness: 0.85 };

  const torsoMat = new THREE.MeshStandardMaterial({ color, ...cloth });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(TORSO_R, TORSO_L, 6, 10), torsoMat);
  torso.position.y = TORSO_Y; torso.castShadow = true; g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 10), new THREE.MeshStandardMaterial({ color: HEAD_COLOR, ...cloth }));
  head.position.y = HEAD_Y; head.castShadow = true; g.add(head);

  const legMat = new THREE.MeshStandardMaterial({ color: LEG_COLOR, ...cloth });
  const legs = [];
  for (const x of [-HIP_X, HIP_X]) {
    const hip = new THREE.Group(); hip.position.set(x, HIP_Y, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(LEG_W, HIP_Y, LEG_W * 1.2), legMat);
    leg.position.y = -HIP_Y / 2; leg.castShadow = true; hip.add(leg);
    g.add(hip); legs.push(hip);
  }

  return { g, torsoMat, legL: legs[0], legR: legs[1] };
}

export function updatePedMesh(mesh, p) {
  const swing = Math.sin(p.phase) * SWING;
  mesh.legL.rotation.x = swing;
  mesh.legR.rotation.x = -swing;
  // Two bobs a stride: highest as the legs pass, settled as they spread.
  mesh.g.position.set(p.x, Math.abs(Math.cos(p.phase)) * BOB, p.z);
  mesh.g.rotation.y = p.axis === 'x'
    ? (p.dir >= 0 ? Math.PI / 2 : -Math.PI / 2)
    : (p.dir >= 0 ? 0 : Math.PI);
}

export function buildTrafficPool(traffic) {
  const g = new THREE.Group();
  const cars = traffic.map((c) => {
    const car = buildCarMesh(c.color);
    g.add(car.g);
    return car;
  });
  return { g, cars };
}

// The shared car view also reads steer, which AI cars do not carry: a reused copy keeps
// their front wheels straight instead of NaN-ing the pivots.
const VIEW = {};
export function updateTrafficPool(view, traffic, dt) {
  for (let i = 0; i < view.cars.length; i++) {
    updateCarMesh(view.cars[i], Object.assign(VIEW, traffic[i], { steer: 0 }), dt);
  }
}
