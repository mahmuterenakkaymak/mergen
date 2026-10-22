import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { engineParams, thudParams, HORN } from '../src/audio/engineModel.js';

describe('engineParams', () => {
  it('maps revs onto the 46-196 Hz band', () => {
    expect(engineParams(0).freq).toBeCloseTo(46);
    expect(engineParams(1).freq).toBeCloseTo(196);
  });

  it('climbs monotonically with speed — pitch, sub and lowpass together', () => {
    let prev = { freq: -Infinity, subFreq: -Infinity, cutoff: -Infinity };
    for (let i = 0; i <= 20; i++) {
      const p = engineParams(i / 20);
      expect(p.freq).toBeGreaterThan(prev.freq);
      expect(p.subFreq).toBeGreaterThan(prev.subFreq);
      expect(p.cutoff).toBeGreaterThan(prev.cutoff);
      prev = p;
    }
  });

  it('runs the sub oscillator an octave under the main one', () => {
    for (const r of [0, 0.4, 1]) {
      const p = engineParams(r);
      expect(p.subFreq).toBeCloseTo(p.freq * 0.5);
    }
  });

  it('holds the band when the sim hands over an out-of-range ratio', () => {
    expect(engineParams(-1).freq).toBeCloseTo(46);
    expect(engineParams(9).freq).toBeCloseTo(196);
  });

  it('keeps an idle rumble and swells with throttle and revs', () => {
    const idle = engineParams(0, 0);
    expect(idle.gain).toBeCloseTo(CONFIG.audio.engineBase);
    expect(engineParams(0, 1).gain).toBeGreaterThan(idle.gain);
    expect(engineParams(1, 1).gain).toBeGreaterThan(engineParams(1, 0).gain);
  });

  it('is silent squeal without slip', () => {
    expect(engineParams(0.5, 0, 0).squealGain).toBe(0);
    expect(engineParams(0.5, 1, 0).squealGain).toBe(0);
    expect(engineParams(1, 0, -0.2).squealGain).toBe(0);
  });

  it('rings the squeal in with slip and caps it at the config level', () => {
    expect(engineParams(0.5, 0, 0.5).squealGain).toBeCloseTo(CONFIG.audio.squeal * 0.5);
    expect(engineParams(0.5, 0, 4).squealGain).toBeCloseTo(CONFIG.audio.squeal);
  });
});

describe('thudParams', () => {
  it('gets louder and brighter with the impact', () => {
    const soft = thudParams(4);
    const hard = thudParams(22);
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(hard.cutoff).toBeGreaterThan(soft.cutoff);
  });

  it('stays inside one hit envelope from a graze to a slam', () => {
    for (const v of [0, 0.5, 3, 12, 40, 200]) {
      const p = thudParams(v);
      expect(p.gain).toBeGreaterThan(0);
      expect(p.gain).toBeLessThanOrEqual(CONFIG.audio.thud);
      expect(p.cutoff).toBeGreaterThan(0);
      expect(p.dur).toBeGreaterThan(p.decay);
    }
  });
});

describe('HORN', () => {
  it('is the two-tone interval at the config horn level', () => {
    expect(HORN.freqs).toEqual([392, 494]);
    expect(HORN.gain).toBeCloseTo(CONFIG.audio.horn);
  });

  it('envelopes before it rings out and stops after the ramp ends', () => {
    expect(HORN.attack).toBeLessThan(HORN.hold);
    expect(HORN.hold).toBeLessThan(HORN.release);
    expect(HORN.release).toBeLessThan(HORN.dur);
  });
});
