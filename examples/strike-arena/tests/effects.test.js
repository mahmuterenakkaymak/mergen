import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEffects } from '../src/render/effects.js';
import { CONFIG } from '../src/config.js';

const E = CONFIG.EFFECTS;

// The event shapes core/game.js and core/bots.js push for a player shot, a bot shot, a
// wall hit and a body hit; effects.js reads nothing else off them.
const shot = (over = {}) => ({
  type: 'shot',
  weapon: 'rifle',
  origin: { x: 0, y: CONFIG.MOVEMENT.eyeHeight, z: 0 },
  dir: { x: 0, y: 0, z: -1 },
  spread: 0,
  scoped: false,
  ...over,
});
const botShot = (over = {}) => ({
  type: 'botShot',
  botId: 'bot_2',
  pos: { x: 4, y: 0, z: -6 },
  origin: { x: 4, y: CONFIG.BOTS.eyeHeight, z: -6 },
  dir: { x: 0, y: 0, z: 1 },
  cone: 0.02,
  weapon: CONFIG.BOTS.weapon,
  ...over,
});
const wallImpact = (over = {}) => ({
  type: 'wallImpact',
  weapon: 'rifle',
  point: { x: 0, y: 1.2, z: -3 },
  normal: { x: 0, y: 0, z: 1 },
  ...over,
});
const bodyHit = (over = {}) => ({
  type: 'hit',
  kind: 'body',
  weapon: 'rifle',
  targetId: 'bot_1',
  damage: 24,
  point: { x: 1, y: 1.2, z: -4 },
  killed: false,
  ...over,
});

const setup = () => {
  const scene = new THREE.Group();
  return { scene, fx: createEffects(scene) };
};
const tracerEndZ = (entry) => entry.line.geometry.attributes.position.array[5];
const tracerStartZ = (entry) => entry.line.geometry.attributes.position.array[2];

describe('createEffects', () => {
  it('adds a single effects group to the scene', () => {
    const { scene } = setup();
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0].name).toBe('effects');
  });

  it('lights a muzzle flash on a shot and hides it once flashTime runs out', () => {
    const { fx } = setup();
    fx.handleEvents([shot()]);

    expect(fx.stats().flashes).toBe(1);
    const flash = fx.debug.flashes[0];
    expect(flash.obj.visible).toBe(true);
    expect(flash.sprite.visible).toBe(true);
    expect(flash.light.intensity).toBeCloseTo(E.flashLightPower, 6);
    // In front of the eye along the shot, and below it like a barrel would be.
    expect(flash.obj.position.z).toBeLessThan(0);
    expect(flash.obj.position.y).toBeLessThan(CONFIG.MOVEMENT.eyeHeight);

    fx.update(E.flashTime);
    expect(fx.stats().flashes).toBe(0);
    expect(flash.obj.visible).toBe(false);
    expect(flash.light.intensity).toBe(0);
  });

  it('fades the flash across its lifetime', () => {
    const { fx } = setup();
    fx.handleEvents([shot()]);
    fx.update(E.flashTime / 2);
    expect(fx.debug.flashes[0].light.intensity).toBeCloseTo(E.flashLightPower / 2, 6);
  });

  it('spawns a tracer on a shot and recycles it after its lifetime', () => {
    const { fx } = setup();
    fx.handleEvents([shot()]);

    expect(fx.stats().tracers).toBe(1);
    const tracer = fx.debug.tracers[0];
    expect(tracer.line.visible).toBe(true);
    expect(tracer.line.material.opacity).toBeCloseTo(1, 6);
    // Starts ahead of the eye and runs down the aim ray.
    expect(tracerStartZ(tracer)).toBeLessThan(0);
    expect(tracerEndZ(tracer)).toBeLessThan(tracerStartZ(tracer));

    fx.update(E.tracerLife / 2);
    expect(tracer.line.material.opacity).toBeCloseTo(0.5, 6);

    fx.update(E.tracerLife / 2);
    expect(fx.stats().tracers).toBe(0);
    expect(tracer.line.visible).toBe(false);

    // The next shot takes the same pooled line back, without growing the pool.
    fx.handleEvents([shot()]);
    expect(fx.debug.tracers).toHaveLength(1);
    expect(fx.debug.tracers[0].line).toBe(tracer.line);
    expect(tracer.line.visible).toBe(true);
  });

  it('ends a tracer at the wall it hit', () => {
    const { fx } = setup();
    fx.handleEvents([shot(), wallImpact({ point: { x: 0, y: CONFIG.MOVEMENT.eyeHeight, z: -5 } })]);
    expect(tracerEndZ(fx.debug.tracers[0])).toBeCloseTo(-5, 5);
  });

  it('tracers never pass the eye they were fired from', () => {
    const { fx } = setup();
    // An impact behind the muzzle: the tracer has nothing left to draw.
    fx.handleEvents([shot(), wallImpact({ point: { x: 0, y: CONFIG.MOVEMENT.eyeHeight, z: 2 } })]);
    expect(fx.stats().tracers).toBe(0);
  });

  it('sparks on a wall impact and falls them under gravity', () => {
    const { fx } = setup();
    fx.handleEvents([wallImpact()]);
    expect(fx.stats().sparks).toBe(E.sparkCount);

    const spark = fx.debug.sparks.find((s) => s.alive);
    const vy = spark.vy;
    fx.update(1 / 60);
    expect(spark.vy).toBeLessThan(vy);
    expect(fx.stats().sparks).toBe(E.sparkCount);
  });

  it('sparks die at sparkLife', () => {
    const { fx } = setup();
    fx.handleEvents([wallImpact()]);
    fx.update(E.sparkLife);
    expect(fx.stats().sparks).toBe(0);
    expect(fx.debug.sparkPoints.geometry.drawRange.count).toBe(0);
  });

  it('keeps the spark pool at its cap and packs the buffer with live sparks only', () => {
    const { fx } = setup();
    const impacts = Array.from({ length: 40 }, (_, i) => wallImpact({ point: { x: i, y: 1, z: -3 } }));
    fx.handleEvents(impacts);

    expect(40 * E.sparkCount).toBeGreaterThan(E.maxSparks);
    expect(fx.debug.sparks).toHaveLength(E.maxSparks);
    expect(fx.stats().sparks).toBe(E.maxSparks);
    fx.update(1 / 60);

    const { geometry } = fx.debug.sparkPoints;
    expect(geometry.attributes.position.count).toBe(E.maxSparks);
    expect(geometry.drawRange.count).toBe(E.maxSparks);
  });

  it('tracers never exceed their cap under sustained fire', () => {
    const { fx } = setup();
    fx.handleEvents(Array.from({ length: E.maxTracers + 12 }, () => shot()));
    expect(fx.debug.tracers).toHaveLength(E.maxTracers);
    expect(fx.stats().tracers).toBe(E.maxTracers);
  });

  it('puts a bullet hole on the wall, laid along its normal and off its face', () => {
    const { fx } = setup();
    fx.handleEvents([wallImpact({ point: { x: 2, y: 1.5, z: -7 } })]);

    expect(fx.stats().decals).toBe(1);
    const mesh = fx.debug.decals[0].mesh;
    expect(mesh.position.x).toBeCloseTo(2, 6);
    expect(mesh.position.y).toBeCloseTo(1.5, 6);
    expect(mesh.position.z).toBeGreaterThan(-7); // lifted off the surface, not inside it

    const facing = new THREE.Vector3();
    mesh.getWorldDirection(facing);
    expect(facing.z).toBeCloseTo(1, 5); // quad +Z along the (0,0,1) wall normal
  });

  it('overwrites the oldest bullet hole once the ring is full', () => {
    const { fx } = setup();
    for (let i = 0; i < E.maxDecals; i++) fx.handleEvents([wallImpact({ point: { x: i, y: 1, z: -3 } })]);
    expect(fx.stats().decals).toBe(E.maxDecals);

    const oldest = fx.debug.decals[0].mesh;
    expect(oldest.position.x).toBeCloseTo(0, 6);

    fx.handleEvents([wallImpact({ point: { x: 99, y: 1, z: -3 } })]);
    expect(fx.stats().decals).toBe(E.maxDecals);
    expect(fx.debug.decals[0].mesh).toBe(oldest); // reused in place, not reallocated
    expect(oldest.position.x).toBeCloseTo(99, 6);
  });

  it('sprays sparks on a body hit but leaves no hole', () => {
    const { fx } = setup();
    fx.handleEvents([bodyHit()]);
    expect(fx.stats().sparks).toBe(E.sparkCount);
    expect(fx.stats().decals).toBe(0);
  });

  it('fires and traces a bot shot from the bot', () => {
    const { fx } = setup();
    fx.handleEvents([botShot()]);
    expect(fx.stats().flashes).toBe(1);
    expect(fx.stats().tracers).toBe(1);
    expect(fx.debug.flashes[0].obj.position.z).toBeGreaterThan(-6); // toward the player
  });

  it('ends a bot tracer at the point its own hitscan reported', () => {
    const { fx } = setup();
    const origin = { x: 4, y: CONFIG.BOTS.eyeHeight, z: -6 };
    fx.handleEvents([botShot({ end: { x: 4, y: origin.y, z: 2 } })]); // 8 m down +Z

    const a = fx.debug.tracers[0].line.geometry.attributes.position.array;
    const length = Math.hypot(a[3] - origin.x, a[4] - origin.y, a[5] - origin.z);
    expect(length).toBeCloseTo(8, 5); // the surface it hit, not the full weapon range
  });

  it('marks the wall a bot shot stopped in', () => {
    const { fx } = setup();
    fx.handleEvents([
      botShot({ end: { x: 4, y: CONFIG.BOTS.eyeHeight, z: 2 }, endNormal: { x: 0, y: 0, z: -1 } }),
    ]);
    expect(fx.stats().sparks).toBe(E.sparkCount);
    expect(fx.stats().decals).toBe(1);
  });

  it('ignores events that carry no effect', () => {
    const { fx } = setup();
    fx.handleEvents([
      { type: 'dryFire', weapon: 'rifle' },
      { type: 'reloadStart', weapon: 'rifle' },
      { type: 'kill', victim: 'bot_1', weapon: 'rifle', headshot: true, point: { x: 0, y: 1, z: -4 } },
      { type: 'roundEnd', result: 'won' },
      { type: 'footstep', surface: 'concrete' },
    ]);
    expect(fx.stats()).toEqual({ flashes: 0, tracers: 0, sparks: 0, decals: 0 });
    fx.update(1 / 60);
    expect(fx.stats()).toEqual({ flashes: 0, tracers: 0, sparks: 0, decals: 0 });
  });

  it('runs the frame with nothing spawned', () => {
    const { fx } = setup();
    expect(() => fx.update(1 / 60)).not.toThrow();
    expect(fx.stats()).toEqual({ flashes: 0, tracers: 0, sparks: 0, decals: 0 });
  });
});
