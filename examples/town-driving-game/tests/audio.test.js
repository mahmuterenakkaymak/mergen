import { describe, it, expect, afterEach } from 'vitest';
import { createAudio } from '../src/audio/audio.js';
import { engineParams, thudParams, HORN } from '../src/audio/engineModel.js';
import { CONFIG } from '../src/config.js';

// Minimal recording AudioContext: nodes carry kind/params/connections, params record every scheduled value.
function installFakeContext() {
  const reg = { ctxs: [], nodes: [] };
  const param = () => {
    const p = { value: 0, targets: [] };
    const rec = (v) => {
      p.value = v;
      p.targets.push(v);
      return p;
    };
    p.setValueAtTime = rec;
    p.linearRampToValueAtTime = rec;
    p.exponentialRampToValueAtTime = rec;
    p.setTargetAtTime = rec;
    return p;
  };
  class FakeAudioContext {
    constructor() {
      reg.ctxs.push(this);
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = { connect: () => this.destination };
      this.suspendCalls = 0;
      this.resumeCalls = 0;
    }
    suspend() {
      this.state = 'suspended';
      this.suspendCalls++;
    }
    resume() {
      this.state = 'running';
      this.resumeCalls++;
    }
    _add(kind, extra) {
      const n = { kind, connections: [] };
      n.connect = (d) => {
        n.connections.push(d);
        return d;
      };
      n.disconnect = () => {};
      Object.assign(n, extra);
      reg.nodes.push(n);
      return n;
    }
    createOscillator() {
      const n = this._add('osc', { type: 'sine', frequency: param(), started: null, stopped: null });
      n.start = (t = 0) => {
        n.started = t;
      };
      n.stop = (t = 0) => {
        n.stopped = t;
      };
      return n;
    }
    createGain() {
      return this._add('gain', { gain: param() });
    }
    createBiquadFilter() {
      return this._add('filter', { type: '', frequency: param(), Q: param() });
    }
    createBufferSource() {
      const n = this._add('src', { buffer: null, loop: false, started: null, stopped: null });
      n.start = (t = 0) => {
        n.started = t;
      };
      n.stop = (t = 0) => {
        n.stopped = t;
      };
      return n;
    }
    createBuffer(ch, len) {
      return { length: len, getChannelData: () => new Float32Array(len) };
    }
  }
  globalThis.AudioContext = FakeAudioContext;
  return reg;
}

const of = (reg, kind) => reg.nodes.filter((n) => n.kind === kind);
const setup = () => {
  const reg = installFakeContext();
  const a = createAudio();
  a.start();
  return { reg, a, ctx: reg.ctxs[0] };
};

afterEach(() => {
  delete globalThis.AudioContext;
});

describe('createAudio without AudioContext', () => {
  it('is a full no-op object in Node', () => {
    expect(typeof AudioContext).toBe('undefined');
    const a = createAudio();
    for (const m of ['start', 'setEngine', 'thud', 'horn', 'suspend', 'resume']) {
      expect(typeof a[m]).toBe('function');
    }
    expect(() => {
      a.start();
      a.setEngine(engineParams(0.5, 0.5, 0.5));
      a.thud(10);
      a.horn(1);
      a.suspend();
      a.resume();
    }).not.toThrow();
  });
});

describe('engine graph (fake context)', () => {
  it('builds nothing until start, and survives calls made before it', () => {
    const reg = installFakeContext();
    const a = createAudio();
    expect(reg.ctxs).toHaveLength(0);
    expect(() => {
      a.setEngine(engineParams(0.5));
      a.thud(10);
      a.horn(1);
      a.suspend();
      a.resume();
    }).not.toThrow();
    expect(reg.ctxs).toHaveLength(0);
  });

  it('runs a saw and a square sub through one lowpass to a master at the config level', () => {
    const { reg, ctx } = setup();
    const oscs = of(reg, 'osc');
    expect(oscs.map((o) => o.type)).toEqual(['sawtooth', 'square']);
    expect(oscs.every((o) => o.started !== null)).toBe(true);

    const filters = of(reg, 'filter');
    const lowpass = filters.find((f) => f.type === 'lowpass');
    const bandpass = filters.find((f) => f.type === 'bandpass');
    expect(oscs.every((o) => o.connections.includes(lowpass))).toBe(true);

    const gains = of(reg, 'gain');
    const master = gains.find((g) => g.connections.includes(ctx.destination));
    expect(master.gain.value).toBe(CONFIG.audio.master);
    expect(lowpass.connections[0].gain.value).toBe(0); // engine starts silent until setEngine
  });

  it('loops noise through the bandpass for squeal, silent at rest', () => {
    const { reg } = setup();
    const src = of(reg, 'src').find((s) => s.loop);
    expect(src.started).not.toBeNull();
    const band = of(reg, 'filter').find((f) => f.type === 'bandpass');
    expect(src.connections).toContain(band);
    const squeal = band.connections[0];
    expect(squeal.gain.value).toBe(0);
  });

  it('setEngine drives pitch, sub, cutoff, engine gain and squeal together', () => {
    const { reg, a } = setup();
    const p = engineParams(0.6, 0.4, 0.8);
    a.setEngine(p);
    const oscs = of(reg, 'osc');
    expect(oscs[0].frequency.value).toBeCloseTo(p.freq);
    expect(oscs[1].frequency.value).toBeCloseTo(p.subFreq);
    const lowpass = of(reg, 'filter').find((f) => f.type === 'lowpass');
    expect(lowpass.frequency.value).toBeCloseTo(p.cutoff);
    const gains = of(reg, 'gain');
    const engineGain = gains.find((g) => lowpass.connections.includes(g));
    const squeal = gains.find((g) => g !== engineGain && g.gain.targets.includes(p.squealGain));
    expect(engineGain.gain.value).toBeCloseTo(p.gain);
    expect(squeal.gain.value).toBeCloseTo(p.squealGain);
  });

  it('starts once and resumes on a later gesture while suspended', () => {
    const { reg, a, ctx } = setup();
    a.start();
    expect(reg.ctxs).toHaveLength(1);
    ctx.state = 'suspended';
    a.start();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
  });
});

describe('one-shot sounds (fake context)', () => {
  it('thud plays one filtered noise hit sized by the impact', () => {
    const { reg, a } = setup();
    const srcs0 = of(reg, 'src').length;
    a.thud(11);
    const p = thudParams(11);
    const hits = of(reg, 'src').slice(srcs0);
    expect(hits).toHaveLength(1);
    expect(hits[0].loop).toBe(false);
    expect(hits[0].started).toBe(0);
    expect(hits[0].stopped).toBeCloseTo(p.dur);
    const lp = of(reg, 'filter').filter((f) => f.type === 'lowpass').at(-1);
    expect(lp.frequency.value).toBeCloseTo(p.cutoff);
    expect(lp.connections[0].gain.targets[0]).toBeCloseTo(p.gain);
  });

  it('horn sounds the two-tone interval, scaled by pitch, stopped after the ring', () => {
    const { reg, a } = setup();
    a.horn(0.5);
    const oscs = of(reg, 'osc').slice(2);
    expect(oscs.map((o) => o.type)).toEqual(['square', 'square']);
    expect(oscs.map((o) => o.frequency.value)).toEqual([HORN.freqs[0] * 0.5, HORN.freqs[1] * 0.5]);
    expect(oscs.every((o) => o.stopped === HORN.dur)).toBe(true);

    a.horn();
    const defaults = of(reg, 'osc').slice(4);
    expect(defaults.map((o) => o.frequency.value)).toEqual([...HORN.freqs]);
  });

  it('suspend and resume reach the context', () => {
    const { a, ctx } = setup();
    a.suspend();
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    a.resume();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
  });
});
