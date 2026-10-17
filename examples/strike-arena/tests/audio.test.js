import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createAudio, SHOT_GENERATORS } from '../src/audio/audio.js';

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
    resumeCalls: 0,
    nodes: [],
    resume() {
      ctx.resumeCalls += 1;
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
  ctx.createGain = () => ctx.add('gain', { gain: param(1) });
  ctx.createOscillator = () => ctx.add('oscillator', { type: 'sine', frequency: param(440) });
  ctx.createBiquadFilter = () => ctx.add('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) });
  ctx.createBufferSource = () => ctx.add('bufferSource', { buffer: null, loop: false });
  ctx.createBuffer = (numberOfChannels, length, sampleRate) => {
    const data = new Float32Array(length);
    ctx.add('buffer', { buffer: { numberOfChannels, length, sampleRate, getChannelData: () => data } });
    return { numberOfChannels, length, sampleRate, getChannelData: () => data };
  };
  return ctx;
}

const of = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind);

describe('SHOT_GENERATORS', () => {
  it('maps every weapon in CONFIG.AUDIO.shots to its own generator', () => {
    const weapons = Object.keys(CONFIG.AUDIO.shots);
    expect(Object.keys(SHOT_GENERATORS).sort()).toEqual(weapons.sort());
    for (const gen of Object.values(SHOT_GENERATORS)) expect(typeof gen).toBe('function');
    // distinct recipes, not one shared function aliased three times
    expect(new Set(Object.values(SHOT_GENERATORS)).size).toBe(weapons.length);
  });
});

describe('createAudio', () => {
  let fake;
  let factory;

  beforeEach(() => {
    fake = createFakeAudioContext();
    factory = vi.fn(() => fake);
  });

  describe('lazy context', () => {
    it('creates nothing until unlock()', () => {
      const audio = createAudio(factory);

      expect(factory).not.toHaveBeenCalled();
      expect(audio.ctx).toBeNull();
      expect(audio.master).toBeNull();
      expect(audio.noiseBuffer).toBeNull();
      expect(audio.playShot('pistol')).toBe(false);
      expect(factory).not.toHaveBeenCalled();
      expect(fake.nodes).toEqual([fake.destination]); // nothing but the context's own sink
    });

    it('builds the master gain and the noise buffer on unlock, and resumes a suspended context', () => {
      const audio = createAudio(factory);

      audio.unlock();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(fake.resumeCalls).toBe(1);
      const master = of(fake, 'gain')[0];
      expect(audio.master).toBe(master);
      expect(master.gain.value).toBeCloseTo(CONFIG.AUDIO.masterVolume, 9);
      expect(master.connections).toContain(fake.destination);
      expect(audio.noiseBuffer.length).toBeGreaterThan(0);
    });

    it('reuses the same context and master gain across repeated unlocks', () => {
      const audio = createAudio(factory);

      audio.unlock();
      audio.unlock();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(of(fake, 'gain')).toHaveLength(1);
      expect(fake.resumeCalls).toBe(1); // already running, so nothing left to resume
    });
  });

  describe('mute', () => {
    it('zeroes the master gain and restores CONFIG.AUDIO.masterVolume on unmute', () => {
      const audio = createAudio(factory);
      audio.unlock();

      expect(audio.setMuted(true)).toBe(true);
      expect(audio.master.gain.value).toBe(0);

      expect(audio.setMuted(false)).toBe(false);
      expect(audio.master.gain.value).toBeCloseTo(CONFIG.AUDIO.masterVolume, 9);
    });

    it('toggleMute flips the state both ways', () => {
      const audio = createAudio(factory);
      audio.unlock();

      expect(audio.toggleMute()).toBe(true);
      expect(audio.muted).toBe(true);
      expect(audio.master.gain.value).toBe(0);

      expect(audio.toggleMute()).toBe(false);
      expect(audio.master.gain.value).toBeCloseTo(CONFIG.AUDIO.masterVolume, 9);
    });

    it('keeps a mute set before unlock, so the first context starts silent', () => {
      const audio = createAudio(factory);
      audio.setMuted(true);

      audio.unlock();

      expect(audio.master.gain.value).toBe(0);
    });

    it('is safe before any context exists', () => {
      const audio = createAudio(factory);

      expect(() => audio.setMuted(true)).not.toThrow();
      expect(audio.toggleMute()).toBe(false);
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe('playShot', () => {
    it('layers a noise burst, a click transient, a lowpass and a swept thump per weapon', () => {
      const audio = createAudio(factory);
      audio.unlock();
      fake.nodes.length = 0;

      expect(audio.playShot('pistol')).toBe(true);

      const sources = of(fake, 'bufferSource');
      expect(sources).toHaveLength(1);
      expect(sources[0].buffer).toBe(audio.noiseBuffer);

      const lowpass = of(fake, 'biquad').filter((n) => n.type === 'lowpass');
      expect(lowpass).toHaveLength(1);
      expect(lowpass[0].frequency.events[0]).toEqual(['set', CONFIG.AUDIO.shots.pistol.lowpassHz, fake.currentTime]);

      const oscs = of(fake, 'oscillator');
      expect(oscs.map((n) => n.type).sort()).toEqual(['sine', 'square']);

      const thump = oscs.find((n) => n.type === 'sine');
      const p = CONFIG.AUDIO.shots.pistol;
      expect(thump.frequency.events).toEqual([
        ['set', p.thumpStartHz, fake.currentTime],
        ['exp', p.thumpEndHz, fake.currentTime + p.duration],
      ]);

      // every layer envelope lands on the master gain, which is the only thing on the destination
      const envelopes = of(fake, 'gain');
      expect(envelopes).toHaveLength(3);
      for (const env of envelopes) expect(env.connections).toContain(audio.master);
      expect(audio.master.connections).toEqual([fake.destination]);
    });

    it('runs a different recipe per weapon', () => {
      const audio = createAudio(factory);
      audio.unlock();

      const recipe = {};
      for (const weapon of Object.keys(CONFIG.AUDIO.shots)) {
        fake.nodes.length = 0;
        expect(audio.playShot(weapon)).toBe(true);
        recipe[weapon] = {
          noise: of(fake, 'bufferSource').length,
          thump: of(fake, 'oscillator').filter((n) => n.type === 'sine').length,
          filters: of(fake, 'biquad').map((n) => `${n.type}:${n.frequency.events[0][1]}`),
        };
      }

      // the config lowpass for each weapon is what actually reaches the filter
      for (const weapon of Object.keys(CONFIG.AUDIO.shots)) {
        expect(recipe[weapon].filters).toContain(`lowpass:${CONFIG.AUDIO.shots[weapon].lowpassHz}`);
      }
      // pistol is the bare skeleton; the rifle adds a crack layer, the sniper a sub thump
      expect(recipe.pistol).toEqual({
        noise: 1,
        thump: 1,
        filters: [`lowpass:${CONFIG.AUDIO.shots.pistol.lowpassHz}`],
      });
      expect(recipe.rifle.noise).toBe(2);
      expect(recipe.rifle.filters.filter((f) => f.startsWith('highpass:'))).toHaveLength(1);
      expect(recipe.sniper.thump).toBe(2);
      expect(new Set(Object.values(recipe).map(JSON.stringify)).size).toBe(3);
    });

    it('is a no-op for an unknown weapon', () => {
      const audio = createAudio(factory);
      audio.unlock();
      fake.nodes.length = 0;

      expect(audio.playShot('shotgun')).toBe(false);
      expect(audio.playShot(undefined)).toBe(false);
      expect(fake.nodes).toHaveLength(0);
    });

    it('shares one white-noise buffer across shots', () => {
      const audio = createAudio(factory);
      audio.unlock();
      const buffers = of(fake, 'buffer');
      expect(buffers).toHaveLength(1);

      audio.playShot('pistol');
      audio.playShot('rifle');
      audio.playShot('sniper');

      const sources = of(fake, 'bufferSource');
      expect(sources.length).toBeGreaterThan(3); // the rifle layers two noise bursts
      for (const src of sources) expect(src.buffer).toBe(audio.noiseBuffer);
      expect(of(fake, 'buffer')).toHaveLength(1);
    });
  });
});
