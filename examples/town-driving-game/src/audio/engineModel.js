// Synthesizer mapping, pure: sim numbers in, WebAudio parameter values out (no AudioContext, no DOM).
import { clamp, lerp } from '../util/math.js';
import { CONFIG } from '../config.js';

const { engineBase, engineLoad, engineRpm, squeal, horn, thud } = CONFIG.audio;

const FREQ_IDLE = 46; // Hz, engine at a standstill
const FREQ_SPAN = 150; // Hz added at full revs, so the band tops out at 196 Hz
const SUB_RATIO = 0.5; // the square oscillator runs an octave under the saw
const CUTOFF_IDLE = 320; // Hz, lowpass floor that keeps idle dark
const CUTOFF_SPAN = 1500; // Hz opened by revs, so the engine brightens as it climbs

const THUD_FULL_V = 22; // m/s closing speed that reads as a full-strength hit
const THUD_CUTOFF = [180, 700]; // Hz, dull bump -> cracking hit
const THUD_DECAY = 0.18; // s, gain ramp to silence
const THUD_DUR = 0.2; // s, noise source stopped here

// speedRatio/load/slip are 0-1; the caller shapes the revs (gear wobble, redline) before they get here.
export function engineParams(speedRatio, load = 0, slip = 0) {
  const rpm = clamp(speedRatio, 0, 1);
  const freq = FREQ_IDLE + rpm * FREQ_SPAN;
  return {
    freq,
    subFreq: freq * SUB_RATIO,
    cutoff: CUTOFF_IDLE + rpm * CUTOFF_SPAN,
    gain: engineBase + clamp(load, 0, 1) * engineLoad + rpm * engineRpm,
    squealGain: clamp(slip, 0, 1) * squeal,
  };
}

const SQUEAL_SLIP = 8; // m/s lateral speed of a slide that reads as a full squeal

// Ordinary cornering slip stays silent: only a real slide (car.skidding) reaches the squealer.
export function squealLevel(slip, skidding) {
  return skidding ? clamp(slip / SQUEAL_SLIP, 0, 1) : 0;
}

// ASSUMPTION: impact is the closing speed in m/s off the collision event, so the /22 scaling lives here.
export function thudParams(impact) {
  const level = clamp(impact / THUD_FULL_V, 0.1, 1);
  return {
    gain: level * thud,
    cutoff: lerp(THUD_CUTOFF[0], THUD_CUTOFF[1], level),
    decay: THUD_DECAY,
    dur: THUD_DUR,
  };
}

export const HORN = Object.freeze({
  type: 'square',
  freqs: Object.freeze([392, 494]), // two-tone car horn
  gain: horn,
  attack: 0.02, // s, ramp up
  hold: 0.22, // s, full volume
  release: 0.32, // s, ramp to silence
  dur: 0.34, // s, oscillators stopped here
});
