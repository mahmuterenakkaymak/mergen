import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createAudio } from '../src/audio/audio.js';

const param = (value = 1) => ({
  value,
  events: [],
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
    return this;
  },
  exponentialRampToValueAtTime(v, t) {
    this.events.push(['exp', v, t]);
    return this;
  },
  linearRampToValueAtTime(v, t) {
    this.events.push(['lin', v, t]);
    return this;
  },
  cancelScheduledValues() {
    return this;
  },
});

function createFakeAudioContext() {
  const ctx = {
    sampleRate: 48000,
    currentTime: 1.25,
    state: 'suspended',
    nodes: [],
    resume() {
      ctx.state = 'running';
      return Promise.resolve();
    },
    add(kind, extra = {}) {
      const n = { kind, connections: [], started: null, stopped: null };
      Object.assign(n, extra);
      n.connect = (dest) => {
        n.connections.push(dest);
        return dest;
      };
      n.disconnect = () => {};
      n.start = (t) => {
        n.started = t;
      };
      n.stop = (t) => {
        n.stopped = t;
      };
      ctx.nodes.push(n);
      return n;
    },
  };
  ctx.destination = ctx.add('destination');
  ctx.listener = ctx.add('listener', {
    pos: null,
    orientation: null,
    setPosition(x, y, z) {
      ctx.listener.pos = { x, y, z };
    },
    setOrientation(fx, fy, fz, ux, uy, uz) {
      ctx.listener.orientation = { forward: { x: fx, y: fy, z: fz }, up: { x: ux, y: uy, z: uz } };
    },
  });
  ctx.createGain = () => ctx.add('gain', { gain: param(1) });
  ctx.createOscillator = () => ctx.add('oscillator', { type: 'sine', frequency: param(440) });
  ctx.createBiquadFilter = () => ctx.add('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) });
  ctx.createBufferSource = () => ctx.add('bufferSource', { buffer: null, loop: false });
  ctx.createPanner = () =>
    ctx.add('panner', {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 10000,
      rolloffFactor: 1,
      pos: null,
      setPosition(x, y, z) {
        this.pos = { x, y, z };
      },
    });
  ctx.createBuffer = (numberOfChannels, length, sampleRate) => {
    const data = new Float32Array(length);
    ctx.add('buffer', { buffer: { numberOfChannels, length, sampleRate, getChannelData: () => data } });
    return { numberOfChannels, length, sampleRate, getChannelData: () => data };
  };
  return ctx;
}

const of = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind);
const hzOf = (node) => node.frequency.events[0][1];
const tones = (ctx) => of(ctx, 'oscillator').filter((n) => n.type === 'triangle').map((n) => hzOf(n));
const bandpassHz = (ctx) => of(ctx, 'biquad').filter((n) => n.type === 'bandpass').map(hzOf);

describe('positional bot fire', () => {
  let fake;
  let audio;

  beforeEach(() => {
    fake = createFakeAudioContext();
    audio = createAudio(() => fake);
    audio.unlock();
    fake.nodes.length = 0;
  });

  it('places a bot shot on an HRTF panner configured from CONFIG.AUDIO', () => {
    const pos = { x: 12, y: 0.5, z: -8 };

    expect(audio.playBotShot(pos, 'rifle')).toBe(true);

    const panners = of(fake, 'panner');
    expect(panners).toHaveLength(1);
    const panner = panners[0];
    expect(panner.panningModel).toBe('HRTF');
    expect(panner.distanceModel).toBe('inverse');
    expect(panner.refDistance).toBe(CONFIG.AUDIO.refDistance);
    expect(panner.maxDistance).toBe(CONFIG.AUDIO.maxDistance);
    expect(panner.rolloffFactor).toBe(CONFIG.AUDIO.rolloffFactor);
    expect(panner.pos).toEqual(pos);
    expect(panner.connections).toContain(audio.master);
  });

  it('runs the weapon recipe into the panner instead of the master gain', () => {
    audio.playBotShot({ x: 3, y: 0, z: 4 }, 'rifle');

    const envelopes = of(fake, 'gain');
    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) expect(env.connections).toContain(of(fake, 'panner')[0]);
    expect(audio.master.connections).toEqual([fake.destination]);
    for (const src of of(fake, 'bufferSource')) expect(src.buffer).toBe(audio.noiseBuffer);
  });

  it('defaults to the bot loadout weapon and stays silent without a position or context', () => {
    const noContext = createAudio(() => fake);
    expect(noContext.playBotShot({ x: 1, y: 0, z: 1 })).toBe(false);

    expect(audio.playBotShot(null)).toBe(false);
    expect(audio.playBotShot({ x: 1, y: 0, z: 1 }, 'shotgun')).toBe(false);
    expect(of(fake, 'panner')).toHaveLength(0);

    expect(audio.playBotShot({ x: 1, y: 0, z: 1 })).toBe(true);
    expect(of(fake, 'panner')).toHaveLength(1);
    expect(of(fake, 'biquad').some((n) => hzOf(n) === CONFIG.AUDIO.shots.rifle.lowpassHz)).toBe(true);
  });
});

describe('setListener', () => {
  let fake;
  let audio;

  beforeEach(() => {
    fake = createFakeAudioContext();
    audio = createAudio(() => fake);
    audio.unlock();
  });

  it('moves the listener to the player', () => {
    expect(audio.setListener({ x: 5, y: 1.65, z: -3 }, 0)).toBe(true);
    expect(fake.listener.pos).toEqual({ x: 5, y: 1.65, z: -3 });
  });

  it('looks down -Z at yaw 0 and turns with yaw', () => {
    audio.setListener({ x: 0, y: 0, z: 0 }, 0);
    expect(fake.listener.orientation.forward.x).toBeCloseTo(0, 9);
    expect(fake.listener.orientation.forward.z).toBeCloseTo(-1, 9);
    expect(fake.listener.orientation.up).toEqual({ x: 0, y: 1, z: 0 });

    audio.setListener({ x: 0, y: 0, z: 0 }, Math.PI / 2);
    expect(fake.listener.orientation.forward.x).toBeCloseTo(-1, 9);
    expect(fake.listener.orientation.forward.z).toBeCloseTo(0, 9);
  });

  it('is a no-op before unlock', () => {
    const fresh = createAudio(() => fake);
    expect(fresh.setListener({ x: 0, y: 0, z: 0 }, 0)).toBe(false);
    expect(fake.listener.pos).toBeNull();
  });
});

describe('playFootstep', () => {
  let fake;
  let audio;

  beforeEach(() => {
    fake = createFakeAudioContext();
    audio = createAudio(() => fake);
    audio.unlock();
    fake.nodes.length = 0;
  });

  it('plays nothing while walking', () => {
    expect(audio.playFootstep('concrete', true)).toBe(false);
    expect(fake.nodes).toHaveLength(0);
  });

  it('scrapes a filtered noise burst when running', () => {
    expect(audio.playFootstep('concrete', false)).toBe(true);
    expect(of(fake, 'bufferSource')).toHaveLength(1);
    expect(bandpassHz(fake).length).toBe(1);
    expect(of(fake, 'oscillator')).toHaveLength(1);
  });

  it('colors the step by surface and falls back to concrete', () => {
    audio.playFootstep('metal');
    const metal = bandpassHz(fake)[0];

    fake.nodes.length = 0;
    audio.playFootstep('concrete');
    const concrete = bandpassHz(fake)[0];

    fake.nodes.length = 0;
    audio.playFootstep('sand');
    expect(bandpassHz(fake)[0]).toBe(concrete);
    expect(metal).not.toBe(concrete);
  });
});

describe('hit, dry fire and round stinger', () => {
  let fake;
  let audio;

  beforeEach(() => {
    fake = createFakeAudioContext();
    audio = createAudio(() => fake);
    audio.unlock();
    fake.nodes.length = 0;
  });

  it('pings once for a body hit and rings a rising two-tone ding for a headshot', () => {
    expect(audio.playHit(false)).toBe(true);
    const body = tones(fake);
    expect(body).toHaveLength(1);

    fake.nodes.length = 0;
    expect(audio.playHit(true)).toBe(true);
    const headshot = of(fake, 'oscillator').filter((n) => n.type === 'triangle');
    expect(headshot).toHaveLength(2);
    expect(hzOf(headshot[1])).toBeGreaterThan(hzOf(headshot[0]));
    expect(headshot[1].started).toBeGreaterThan(headshot[0].started);
    expect(tones(fake)[0]).not.toBe(body[0]);
  });

  it('clicks the empty chamber with a shorter burst than a reload', () => {
    expect(audio.playDryFire()).toBe(true);
    const dry = of(fake, 'bufferSource')[0].stopped - of(fake, 'bufferSource')[0].started;

    fake.nodes.length = 0;
    audio.playReload('magOut');
    const mag = of(fake, 'bufferSource')[0].stopped - of(fake, 'bufferSource')[0].started;

    expect(dry).toBeLessThan(mag);
    expect(of(fake, 'oscillator')).toHaveLength(1);
  });

  it('gives each reload stage its own click and ignores an unknown one', () => {
    const stages = {};
    for (const stage of ['magOut', 'magIn', 'slide']) {
      fake.nodes.length = 0;
      expect(audio.playReload(stage)).toBe(true);
      stages[stage] = bandpassHz(fake)[0];
    }
    expect(new Set(Object.values(stages)).size).toBe(3);

    fake.nodes.length = 0;
    expect(audio.playReload('boltCarrier')).toBe(false);
    expect(audio.playReload()).toBe(true); // no stage is the start of the cycle
    expect(fake.nodes.length).toBeGreaterThan(0);
  });

  it('walks a round-end stinger up when won and down when lost', () => {
    expect(audio.playRoundEnd(true)).toBe(true);
    const won = tones(fake);
    expect(won).toHaveLength(3);
    expect(won[1]).toBeGreaterThan(won[0]);
    expect(won[2]).toBeGreaterThan(won[1]);

    fake.nodes.length = 0;
    expect(audio.playRoundEnd(false)).toBe(true);
    const lost = tones(fake);
    expect(lost[1]).toBeLessThan(lost[0]);
    expect(lost[2]).toBeLessThan(lost[1]);
    expect(lost).not.toEqual(won);
  });
});

describe('handleEvents', () => {
  let fake;
  let audio;

  beforeEach(() => {
    fake = createFakeAudioContext();
    audio = createAudio(() => fake);
    audio.unlock();
    fake.nodes.length = 0;
  });

  it('routes shot, hit and reload events to their sounds', () => {
    const played = audio.handleEvents([
      { type: 'shot', weapon: 'pistol' },
      { type: 'hit', kind: 'head', targetId: 'bot-2', killed: false },
      { type: 'reloadStart', weapon: 'pistol' },
      { type: 'reloadEnd', weapon: 'pistol' },
    ]);

    expect(played).toBe(4);
    expect(of(fake, 'biquad').some((n) => n.type === 'lowpass' && hzOf(n) === CONFIG.AUDIO.shots.pistol.lowpassHz)).toBe(
      true,
    );
    expect(tones(fake)).toContain(1560); // the headshot ding
    expect(bandpassHz(fake)).toEqual(expect.arrayContaining([900, 620])); // mag out, then mag in
  });

  it('positions bot gunfire and leaves the player shot in the centre', () => {
    audio.handleEvents([
      { type: 'shot', weapon: 'rifle' },
      { type: 'botShot', botId: 'bot-3', pos: { x: -6, y: 0, z: 9 }, weapon: 'rifle' },
    ]);

    const panners = of(fake, 'panner');
    expect(panners).toHaveLength(1);
    expect(panners[0].pos).toEqual({ x: -6, y: 0, z: 9 });
  });

  it('hears running footsteps and swallows quiet ones', () => {
    const walkRatio = CONFIG.MOVEMENT.walkSpeed / CONFIG.MOVEMENT.runSpeed;

    expect(audio.handleEvents([{ type: 'footstep', speedRatio: 1, crouched: false }])).toBe(1);
    expect(fake.nodes.length).toBeGreaterThan(0);

    fake.nodes.length = 0;
    expect(audio.handleEvents([{ type: 'footstep', speedRatio: walkRatio, crouched: false }])).toBe(0);
    expect(audio.handleEvents([{ type: 'footstep', speedRatio: 1, crouched: true }])).toBe(0);
    expect(fake.nodes).toHaveLength(0);
  });

  it('marks the round result, the empty click and ignores what makes no sound', () => {
    expect(audio.handleEvents([{ type: 'roundEnd', result: 'won' }, { type: 'dryFire' }])).toBe(2);
    expect(tones(fake).length).toBe(3);

    fake.nodes.length = 0;
    expect(audio.handleEvents([{ type: 'kill', victim: 'bot-1' }, { type: 'switch', weapon: 'sniper' }])).toBe(0);
    expect(fake.nodes).toHaveLength(0);
  });

  it('is safe with no context and with nothing to play', () => {
    const fresh = createAudio(() => fake);
    expect(fresh.handleEvents([{ type: 'shot', weapon: 'pistol' }])).toBe(0);
    expect(fake.nodes.some((n) => n.kind === 'bufferSource')).toBe(false);

    expect(audio.handleEvents([])).toBe(0);
    expect(audio.handleEvents(undefined)).toBe(0);
  });
});
