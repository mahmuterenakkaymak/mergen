import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBotModel, animateBot, setDeathPose, setFade } from '../src/render/botModel.js';
import { CONFIG } from '../src/config.js';

const B = CONFIG.BOTS;
const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR', 'weapon'];

const rotX = (model, name) => model.getObjectByName(name).rotation.x;

describe('createBotModel', () => {
  it('has every named part the sync layer relies on', () => {
    const model = createBotModel();
    expect(model).toBeInstanceOf(THREE.Group);
    for (const name of PARTS) {
      expect(model.getObjectByName(name), `${name} exists`).toBeTruthy();
    }
  });

  it('puts the head mesh exactly on the head hitbox', () => {
    const model = createBotModel();
    model.updateMatrixWorld(true);
    const head = model.getObjectByName('head');

    const y = head.getWorldPosition(new THREE.Vector3()).y;
    // botHitboxes(): head AABB spans [bodyHeight, bodyHeight + headSize] above the feet.
    expect(y - B.headSize / 2).toBeCloseTo(B.bodyHeight, 6);
    expect(y + B.headSize / 2).toBeCloseTo(B.bodyHeight + B.headSize, 6);
    expect(head.geometry.parameters.height).toBeCloseTo(B.headSize, 6);
  });

  it('accepts custom colors', () => {
    const model = createBotModel({ torso: 0xff0000 });
    expect(model.getObjectByName('torso').material.color.getHex()).toBe(0xff0000);
  });
});

describe('animateBot', () => {
  it('swings the legs in opposite phase while walking', () => {
    const model = createBotModel();
    animateBot(model, { speed: B.runSpeed, phase: Math.PI / 2, aimPitch: 0 });
    const legL = rotX(model, 'legL');
    const legR = rotX(model, 'legR');
    expect(legL).not.toBe(0);
    expect(Math.sign(legL)).toBe(-Math.sign(legR));
    expect(Math.abs(legL)).toBeCloseTo(Math.abs(legR), 6);
  });

  it('returns the limbs to rest at zero speed', () => {
    const model = createBotModel();
    animateBot(model, { speed: 0, phase: 1.23, aimPitch: 0 });
    expect(rotX(model, 'legL')).toBeCloseTo(0, 6);
    expect(rotX(model, 'legR')).toBeCloseTo(0, 6);
  });

  it('pitching raises the arms and the held rifle together', () => {
    const model = createBotModel();
    animateBot(model, { speed: 0, phase: 0, aimPitch: 0.3 });
    expect(rotX(model, 'weapon')).toBeCloseTo(0.3, 6);
    expect(rotX(model, 'armL')).toBeGreaterThan(0);
    expect(rotX(model, 'armR')).toBeGreaterThan(0);
  });
});

describe('setDeathPose', () => {
  it('rotates the root toward horizontal as t runs 0..1', () => {
    const model = createBotModel();
    setDeathPose(model, 0);
    expect(model.rotation.x).toBeCloseTo(0, 6);
    setDeathPose(model, 0.5);
    expect(Math.abs(model.rotation.x)).toBeCloseTo(Math.PI / 4, 6);
    setDeathPose(model, 1);
    expect(Math.abs(model.rotation.x)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('topples toward the direction the bot faces', () => {
    const model = createBotModel();
    // yaw PI/2 = facing -X, so a full topple must carry the head along -X, not -Z.
    model.rotation.y = Math.PI / 2;
    setDeathPose(model, 1);
    model.updateMatrixWorld(true);

    const head = model.getObjectByName('head').getWorldPosition(new THREE.Vector3());
    expect(head.x).toBeLessThan(-1);
    expect(Math.abs(head.z)).toBeLessThan(0.5);
  });

  it('clamps t outside 0..1', () => {
    const model = createBotModel();
    setDeathPose(model, 1);
    const at1 = model.rotation.x;
    setDeathPose(model, 5);
    expect(model.rotation.x).toBe(at1);
    setDeathPose(model, -2);
    expect(model.rotation.x).toBeCloseTo(0, 6);
  });
});

describe('setFade', () => {
  it('sets opacity on every mesh', () => {
    const model = createBotModel();
    setFade(model, 0.4);
    let seen = 0;
    model.traverse((o) => {
      if (!o.isMesh) return;
      seen += 1;
      expect(o.material.opacity).toBeCloseTo(0.4, 6);
      expect(o.material.transparent).toBe(true);
    });
    expect(seen).toBeGreaterThanOrEqual(PARTS.length);
  });

  it('turns transparency back off at full alpha', () => {
    const model = createBotModel();
    setFade(model, 0.2);
    setFade(model, 1);
    model.traverse((o) => {
      if (!o.isMesh) return;
      expect(o.material.opacity).toBeCloseTo(1, 6);
      expect(o.material.transparent).toBe(false);
    });
  });
});
