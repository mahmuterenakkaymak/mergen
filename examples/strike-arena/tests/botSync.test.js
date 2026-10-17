import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBotSync } from '../src/render/botSync.js';
import { CONFIG } from '../src/config.js';

const B = CONFIG.BOTS;
const LIFETIME = CONFIG.ROUNDS.corpseLifetime;
const FADE = B.corpseFadeTime;

// The sync layer only ever reads these fields off a bot, so a plain object stands in for
// a real one from core/bots.js.
const makeBot = (id, over = {}) => ({
  id,
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  yaw: 0,
  alive: true,
  state: 'patrol',
  deathTime: null,
  removable: false,
  ...over,
});

const makeWorld = (bots, time = 0) => ({ bots, time, config: CONFIG });
const modelsIn = (scene) => scene.children.filter((o) => o.name === 'bot');
const opacityOf = (model) => model.getObjectByName('torso').material.opacity;
const limbRot = (model, name) => model.getObjectByName(name).rotation.x;

describe('createBotSync', () => {
  it('adds one model per bot and reuses them on the next frame', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const world = makeWorld(Array.from({ length: 5 }, (_, i) => makeBot(`bot_${i + 1}`)));

    botSync.sync(world, 1 / 60);
    const first = modelsIn(scene);
    expect(first).toHaveLength(5);
    expect(first[0]).toBeInstanceOf(THREE.Group);
    expect(first[0].getObjectByName('head')).toBeTruthy();

    botSync.sync(world, 1 / 60);
    const again = modelsIn(scene);
    expect(again).toHaveLength(5);
    expect(again[0]).toBe(first[0]);
  });

  it('puts the root at the bot feet and turns it with its yaw', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bot = makeBot('bot_1', { pos: { x: 3, y: 0.5, z: -4 }, yaw: 1.2 });

    botSync.sync(makeWorld([bot]), 1 / 60);
    const model = botSync.get('bot_1');

    expect(model.position.x).toBeCloseTo(3, 6);
    expect(model.position.y).toBeCloseTo(0.5, 6);
    expect(model.position.z).toBeCloseTo(-4, 6);
    expect(model.rotation.y).toBeCloseTo(1.2, 6);
  });

  it('walks a moving bot and settles a standing one', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bot = makeBot('bot_1', { vel: { x: B.runSpeed, y: 0, z: 0 } });
    const world = makeWorld([bot]);

    botSync.sync(world, 1 / 60);
    botSync.sync(world, 1 / 60);
    const model = botSync.get('bot_1');
    const legL = limbRot(model, 'legL');
    const legR = limbRot(model, 'legR');
    expect(legL).not.toBeCloseTo(0, 6);
    expect(Math.sign(legL)).toBe(-Math.sign(legR));

    bot.vel = { x: 0, y: 0, z: 0 };
    botSync.sync(world, 1 / 60);
    expect(limbRot(model, 'legL')).toBeCloseTo(0, 6);
    expect(limbRot(model, 'legR')).toBeCloseTo(0, 6);
  });

  it('follows a bot as it moves through the round', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bot = makeBot('bot_1');
    const world = makeWorld([bot]);

    botSync.sync(world, 1 / 60);
    bot.pos = { x: 10, y: 0, z: 7 };
    botSync.sync(world, 1 / 60);

    expect(botSync.get('bot_1').position.x).toBeCloseTo(10, 6);
    expect(modelsIn(scene)).toHaveLength(1);
  });

  it('topples and then fades a corpse from its age', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bot = makeBot('bot_1', { alive: false, state: 'dead', deathTime: 0 });
    const model = () => botSync.get('bot_1');

    botSync.sync(makeWorld([bot], 0), 1 / 60);
    expect(model().rotation.x).toBeCloseTo(0, 6);
    expect(opacityOf(model())).toBeCloseTo(1, 6);

    // Past the topple, still inside the opaque part of the lifetime.
    botSync.sync(makeWorld([bot], 1), 1 / 60);
    expect(Math.abs(model().rotation.x)).toBeCloseTo(Math.PI / 2, 6);
    expect(opacityOf(model())).toBeCloseTo(1, 6);

    botSync.sync(makeWorld([bot], LIFETIME - FADE / 2), 1 / 60);
    expect(opacityOf(model())).toBeCloseTo(0.5, 6);
  });

  it('detaches the model once the corpse is removed', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bots = Array.from({ length: 5 }, (_, i) => makeBot(`bot_${i + 1}`));
    const world = makeWorld(bots);

    botSync.sync(world, 1 / 60);
    expect(modelsIn(scene)).toHaveLength(5);

    bots[2].removable = true;
    botSync.sync(world, 1 / 60);

    expect(modelsIn(scene)).toHaveLength(4);
    expect(scene.children).toHaveLength(4);
    expect(botSync.get('bot_3')).toBeNull();
  });

  it('detaches a bot that drops out of world.bots', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bots = [makeBot('bot_1'), makeBot('bot_2')];
    const world = makeWorld(bots);

    botSync.sync(world, 1 / 60);
    world.bots = [bots[0]];
    botSync.sync(world, 1 / 60);

    expect(modelsIn(scene)).toHaveLength(1);
    expect(botSync.get('bot_2')).toBeNull();
  });

  it('stands a revived corpse back up for the next round', () => {
    const scene = new THREE.Group();
    const botSync = createBotSync(scene);
    const bot = makeBot('bot_1', { alive: false, state: 'dead', deathTime: 0 });
    const world = makeWorld([bot]);

    botSync.sync(makeWorld([bot], LIFETIME - 0.1), 1 / 60);
    const model = botSync.get('bot_1');
    expect(Math.abs(model.rotation.x)).toBeGreaterThan(1);
    expect(opacityOf(model)).toBeLessThan(1);

    // resetRound hands back the same bot object, revived.
    Object.assign(bot, { alive: true, state: 'patrol', deathTime: null, removable: false });
    botSync.sync(world, 1 / 60);

    expect(botSync.get('bot_1')).toBe(model);
    expect(model.rotation.x).toBeCloseTo(0, 6);
    expect(opacityOf(model)).toBeCloseTo(1, 6);
    expect(model.getObjectByName('torso').material.transparent).toBe(false);
  });
});
