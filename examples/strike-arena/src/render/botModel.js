// Third-person bot visuals: a ~10-box humanoid sized straight from CONFIG.BOTS, so the
// head mesh lands exactly on the head hitbox from core/bots.js — what the player aims
// at is what actually registers. The root sits at the bot's feet (same convention as
// bot.pos); botSync.js drives position and yaw on the root and calls the three helpers
// below for animation, death and fade.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const DEFAULT_COLORS = {
  torso: 0x3a4248,
  limb: 0x2b3137,
  head: 0x4a5359,
  visor: 0x4fa3d1,
  weapon: 0x23272b,
};

const LEG_SWING = 0.55; // rad, leg amplitude at full run speed
const ARM_SWING_RATIO = 0.6; // arms counter-swing softer than the legs
const FALL_ANGLE = -Math.PI / 2; // root pitch at t=1: tips over toward the facing (-Z)

function mesh(geo, color, pos) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

// Limb pivot: a Group at the hip/shoulder with the mesh hanging below it, so a
// rotation.x swings the limb like a pendulum instead of spinning a whole leg.
function pivot(name, x, y) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, 0);
  return g;
}

export function createBotModel(colors = {}) {
  const c = { ...DEFAULT_COLORS, ...colors };
  const b = CONFIG.BOTS;

  const root = new THREE.Group();
  root.name = 'bot';
  // 'YXZ' so the death pitch (setDeathPose) rotates about the bot's own X axis. With the
  // default 'XYZ' the pitch lands in world space and every corpse topples toward -Z.
  root.rotation.order = 'YXZ';

  const legH = b.bodyHeight * 0.5;
  const legW = b.bodyWidth * 0.32;
  const torsoH = b.bodyHeight - legH;
  const torsoW = b.bodyWidth * 0.85;
  const torsoD = b.bodyWidth * 0.55;

  const torso = mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), c.torso, [0, legH + torsoH / 2, 0]);
  torso.name = 'torso';
  root.add(torso);

  for (const [name, side] of [
    ['legL', -1],
    ['legR', 1],
  ]) {
    const hip = pivot(name, side * b.bodyWidth * 0.2, legH);
    hip.add(mesh(new THREE.BoxGeometry(legW, legH, legW), c.limb, [0, -legH / 2, 0]));
    root.add(hip);
  }

  const armLen = b.bodyHeight * 0.45;
  const armW = b.bodyWidth * 0.22;
  for (const [name, side] of [
    ['armL', -1],
    ['armR', 1],
  ]) {
    const shoulder = pivot(name, side * (torsoW / 2 + armW / 2 + 0.01), b.bodyHeight - 0.02);
    shoulder.add(mesh(new THREE.BoxGeometry(armW, armLen, armW), c.limb, [0, -armLen / 2, 0]));
    root.add(shoulder);
  }

  // Same centre and size as the head AABB in botHitboxes(), so headshots line up.
  const head = mesh(new THREE.BoxGeometry(b.headSize, b.headSize, b.headSize), c.head, [
    0,
    b.bodyHeight + b.headSize / 2,
    0,
  ]);
  head.name = 'head';
  head.add(mesh(new THREE.BoxGeometry(b.headSize * 0.8, b.headSize * 0.3, 0.02), c.visor, [0, 0.02, -(b.headSize / 2 + 0.011)]));
  root.add(head);

  // Held rifle in front of the chest, barrel toward -Z like the viewmodels; aimPitch
  // pitches the whole group around the grip.
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  weapon.position.set(b.bodyWidth * 0.15, legH + torsoH * 0.55, -0.3);
  weapon.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.34), c.weapon, [0, 0, 0]));
  weapon.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), c.weapon, [0, 0.01, -0.3]));
  root.add(weapon);

  return root;
}

// Pure pose function: speed scales the stride (capped at run speed), phase is the walk
// cycle clock the caller keeps, aimPitch raises the arms and the rifle together.
export function animateBot(model, { speed = 0, phase = 0, aimPitch = 0 } = {}) {
  const amp = LEG_SWING * Math.min(Math.abs(speed) / CONFIG.BOTS.runSpeed, 1);
  const swing = Math.sin(phase) * amp;
  const armSwing = swing * ARM_SWING_RATIO;

  model.getObjectByName('legL').rotation.x = swing;
  model.getObjectByName('legR').rotation.x = -swing;
  model.getObjectByName('armL').rotation.x = aimPitch - armSwing;
  model.getObjectByName('armR').rotation.x = aimPitch + armSwing;
  model.getObjectByName('weapon').rotation.x = aimPitch;
  model.getObjectByName('head').rotation.x = aimPitch;
}

// t runs 0..1 across the topple; the root pitches toward horizontal, falling toward
// the direction the bot faces. Scrubbable: t=0 is always the standing pose.
export function setDeathPose(model, t) {
  const p = Math.min(Math.max(t, 0), 1);
  model.rotation.x = p * FALL_ANGLE;
  return model.rotation.x;
}

// Corpse fade-out: every material on the model gets the same alpha. transparent only
// flips on while actually fading, so resting bots keep the cheap opaque path.
export function setFade(model, alpha) {
  const a = Math.min(Math.max(alpha, 0), 1);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const wantTransparent = a < 1;
    if (o.material.transparent !== wantTransparent) {
      o.material.transparent = wantTransparent;
      o.material.needsUpdate = true;
    }
    o.material.opacity = a;
  });
  return a;
}
