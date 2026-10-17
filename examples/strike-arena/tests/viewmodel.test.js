import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createViewmodels } from '../src/render/viewmodel.js';

const WEAPONS = ['pistol', 'rifle', 'sniper'];

function meshColors(group) {
  const colors = new Set();
  group.traverse((o) => {
    if (o.isMesh) colors.add(o.material.color.getHex());
  });
  return colors;
}

describe('createViewmodels', () => {
  it('returns a THREE.Group per weapon', () => {
    const vm = createViewmodels();
    for (const name of WEAPONS) {
      expect(vm[name], `${name} exists`).toBeInstanceOf(THREE.Group);
      expect(vm[name].children.length).toBeGreaterThan(0);
    }
  });

  it('puts a named muzzle transform at the front of every gun', () => {
    const vm = createViewmodels();
    for (const name of WEAPONS) {
      const muzzle = vm[name].getObjectByName('muzzle');
      expect(muzzle, `${name} has a muzzle`).toBeInstanceOf(THREE.Object3D);
      expect(muzzle.isMesh, 'the muzzle is an empty transform, not geometry').toBeFalsy();
      // The camera looks down -Z, so the muzzle must sit ahead of the gun's origin.
      expect(muzzle.position.z).toBeLessThan(0);
    }
  });

  it('builds each gun out of several distinctly colored parts', () => {
    const vm = createViewmodels();
    for (const name of WEAPONS) {
      expect(meshColors(vm[name]).size, `${name} reads as separate pieces`).toBeGreaterThanOrEqual(3);
    }
  });

  it('shows only the active weapon', () => {
    const vm = createViewmodels();
    for (const name of WEAPONS) {
      vm.setActive(name);
      expect(vm.active).toBe(name);
      for (const other of WEAPONS) {
        expect(vm[other].visible, `${other} after setActive(${name})`).toBe(other === name);
      }
    }
  });

  it('starts with a weapon already active', () => {
    const vm = createViewmodels();
    expect(WEAPONS).toContain(vm.active);
    expect(WEAPONS.filter((w) => vm[w].visible)).toEqual([vm.active]);
  });

  it('poses the reload by tilting the gun and dropping the magazine', () => {
    const vm = createViewmodels();
    const gun = vm.rifle;
    const mag = gun.getObjectByName('mag');
    expect(mag).toBeTruthy();

    const restY = mag.position.y;
    vm.setReload('rifle', 0.5);
    expect(gun.rotation.x).not.toBe(0);
    expect(mag.position.y).toBeLessThan(restY);

    // Progress is scrubbed, not animated: both ends of the timeline are the rest pose.
    vm.setReload('rifle', 0);
    expect(gun.rotation.x).toBeCloseTo(0, 6);
    expect(mag.position.y).toBeCloseTo(restY, 6);
    vm.setReload('rifle', 1);
    expect(gun.rotation.x).toBeCloseTo(0, 6);
    expect(mag.position.y).toBeCloseTo(restY, 6);
  });

  it('poses each weapon independently', () => {
    const vm = createViewmodels();
    vm.setReload('pistol', 0.5);
    expect(vm.rifle.rotation.x).toBe(0);
    expect(vm.sniper.rotation.x).toBe(0);
  });
});
