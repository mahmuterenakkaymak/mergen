import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFxView, syncParticles, syncSkids } from '../src/fx/fxView.js';
import { createParticles, spawn } from '../src/fx/particles.js';
import { createSkids, emitSkids } from '../src/fx/skids.js';

const skiddingCar = (heading) => ({ x: 0, z: 0, heading, skidding: true });

describe('fxView', () => {
  it('draws particles as a Points cloud with per-vertex colour and no depth write', () => {
    const view = buildFxView(createParticles(), createSkids());
    expect(view.points.isPoints).toBe(true);
    expect(view.points.material.vertexColors).toBe(true);
    expect(view.points.material.depthWrite).toBe(false);
  });

  it('sizes the particle buffers to the pool', () => {
    const pool = createParticles();
    const view = buildFxView(pool, createSkids());
    const { position, color } = view.points.geometry.attributes;
    expect(position.count).toBe(pool.capacity);
    expect(color.count).toBe(pool.capacity);
  });

  it('copies particle positions and colours into the buffer on sync', () => {
    const pool = createParticles();
    const view = buildFxView(pool, createSkids()); // built before the spawn: buffer is stale
    spawn(pool, 3, 4, 5, 0, 0, 0, 1, 0.25, 0.5, 0.75);
    syncParticles(view, pool);
    const { position, color } = view.points.geometry.attributes;
    expect([position.array[0], position.array[1], position.array[2]]).toEqual([3, 4, 5]);
    expect([color.array[0], color.array[1], color.array[2]]).toEqual([0.25, 0.5, 0.75]);
  });

  it('draws skids as one translucent InstancedMesh just above the road', () => {
    const view = buildFxView(createParticles(), createSkids());
    expect(view.skidMesh.isInstancedMesh).toBe(true);
    expect(view.skidMesh.material.transparent).toBe(true);
    expect(view.skidMesh.material.depthWrite).toBe(false);
    expect(view.skidMesh.material.opacity).toBeGreaterThan(0);
    expect(view.skidMesh.material.opacity).toBeLessThan(1);
  });

  it('sizes the skid instances to the pool and starts empty', () => {
    const skids = createSkids();
    const view = buildFxView(createParticles(), skids);
    expect(view.skidMesh.instanceMatrix.count).toBe(skids.capacity);
    expect(view.skidMesh.count).toBe(0);
  });

  it('copies each skid quad to its slot, height and heading on sync', () => {
    const skids = createSkids();
    const view = buildFxView(createParticles(), skids);
    emitSkids(skids, skiddingCar(0.7)); // two rear-wheel quads
    syncSkids(view, skids);
    expect(view.skidMesh.count).toBe(skids.count);
    expect(view.skidMesh.count).toBe(2);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < skids.count; i++) {
      view.skidMesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(p.x).toBeCloseTo(skids.x[i], 4);
      expect(p.z).toBeCloseTo(skids.z[i], 4);
      expect(p.y).toBeGreaterThan(0); // floats above the asphalt
      expect(p.y).toBeLessThan(0.02); // below the centre-line dashes
      // the quad's length axis (local +Z) points along the heading it was laid down at
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(fwd.x).toBeCloseTo(Math.sin(skids.heading[i]), 3);
      expect(fwd.z).toBeCloseTo(Math.cos(skids.heading[i]), 3);
    }
  });
});
