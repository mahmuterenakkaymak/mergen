// WebAudio graph: dual-oscillator engine through a lowpass, looping-noise tire squeal, thud, horn.
// Nothing is built until start() runs on a user gesture; every call is a safe no-op without AudioContext.
import { CONFIG } from '../config.js';
import { engineParams, thudParams, HORN } from './engineModel.js';

const SQUEAL_FREQ = 1800; // Hz, bandpass center for tire squeal
const SQUEAL_Q = 3;
const SMOOTH = 0.05; // s, setTargetAtTime constant: glide without zipper noise

// Ignition: the starter turns over in CRANK_CHUGS chugs under a rising motor whine, then
// the engine catches, blips once and settles back to idle.
const CRANK_DUR = 0.5; // s the starter is heard
const CRANK_CHUGS = 4; // starter revolutions before it fires
const CRANK_GAIN = 0.26; // crank noise level
const CRANK_CUTOFF = 900; // Hz, keeps the crank a rumble rather than a hiss
const CRANK_DUTY = 0.4; // part of each chug spent rising, the rest falling back
const WHINE = [38, 74]; // Hz, the starter motor climbing as it spins the engine up
const WHINE_GAIN = 0.09;
const REV_FREQ = 118; // Hz the engine blips to when it fires (idle sits at 46)
const REV_GAIN = 0.11; // above engineBase, so the catch is heard
const REV_CUTOFF = 700; // Hz the lowpass opens for the rev, so it brightens
const REV_UP = 0.22; // s idle -> peak
const REV_DOWN = 0.7; // s peak -> idle

// One rev of an oscillator: idle -> peak -> idle, ending on the value engineParams says
// idle is, so the per-frame setEngine takes over without a step.
function rev(osc, idle, peak, t0) {
  osc.frequency.setValueAtTime(idle, t0);
  osc.frequency.linearRampToValueAtTime(peak, t0 + REV_UP);
  osc.frequency.linearRampToValueAtTime(idle, t0 + REV_UP + REV_DOWN);
}

function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function createAudio() {
  const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : null;
  let ctx = null;
  let master = null;
  let noise = null;
  let engine = null; // { osc, sub, filter, gain, squeal }
  let crankEnd = 0; // audio-clock time the ignition envelope stops owning the engine

  function start() {
    if (!Ctor) return;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = CONFIG.audio.master;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(master);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    osc.connect(filter);
    sub.connect(filter);
    osc.start();
    sub.start();

    noise = makeNoise(ctx);
    const squeal = ctx.createGain();
    squeal.gain.value = 0;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = SQUEAL_FREQ;
    band.Q.value = SQUEAL_Q;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.connect(band).connect(squeal).connect(master);
    src.start();

    engine = { osc, sub, filter, gain, squeal };
  }

  function setEngine(p) {
    if (!engine) return;
    if (ctx.currentTime < crankEnd) return; // the ignition owns the revs until it lands
    const t = ctx.currentTime;
    engine.osc.frequency.setTargetAtTime(p.freq, t, SMOOTH);
    engine.sub.frequency.setTargetAtTime(p.subFreq, t, SMOOTH);
    engine.filter.frequency.setTargetAtTime(p.cutoff, t, SMOOTH);
    engine.gain.gain.setTargetAtTime(p.gain, t, SMOOTH);
    engine.squeal.gain.setTargetAtTime(p.squealGain, t, SMOOTH);
  }

  function thud(impact) {
    if (!ctx) return;
    const p = thudParams(impact);
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + p.dur);
  }

  function horn(pitch = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(HORN.gain, t + HORN.attack);
    g.gain.setValueAtTime(HORN.gain, t + HORN.hold);
    g.gain.linearRampToValueAtTime(0, t + HORN.release);
    g.connect(master);
    for (const f of HORN.freqs) {
      const o = ctx.createOscillator();
      o.type = HORN.type;
      o.frequency.value = f * pitch;
      o.connect(g);
      o.start(t);
      o.stop(t + HORN.dur);
    }
  }

  // The gesture that starts the game also turns the engine over: noise chopped into starter
  // chugs under a rising motor whine, then one rev that lands on idle. The engine stays
  // silent through the crank (see setEngine), so what is heard is crank, then idle.
  function ignition() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const fire = t + CRANK_DUR;
    crankEnd = fire + REV_UP + REV_DOWN;

    const chug = ctx.createGain();
    const chop = CRANK_DUR / CRANK_CHUGS;
    chug.gain.setValueAtTime(CRANK_GAIN * 0.3, t);
    for (let i = 0; i < CRANK_CHUGS; i++) {
      const s = t + i * chop;
      chug.gain.linearRampToValueAtTime(CRANK_GAIN, s + chop * CRANK_DUTY);
      chug.gain.linearRampToValueAtTime(CRANK_GAIN * 0.3, s + chop);
    }
    chug.gain.linearRampToValueAtTime(0, fire + 0.04);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = CRANK_CUTOFF;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.connect(lp).connect(chug).connect(master);
    src.start(t);
    src.stop(fire + 0.06);

    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(WHINE[0], t);
    motor.frequency.linearRampToValueAtTime(WHINE[1], fire);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(WHINE_GAIN, t);
    mg.gain.linearRampToValueAtTime(0, fire + 0.02);
    motor.connect(mg).connect(master);
    motor.start(t);
    motor.stop(fire + 0.04);

    const idle = engineParams(0);
    rev(engine.osc, idle.freq, REV_FREQ, fire);
    rev(engine.sub, idle.subFreq, REV_FREQ * 0.5, fire);
    engine.filter.frequency.setValueAtTime(idle.cutoff, fire);
    engine.filter.frequency.linearRampToValueAtTime(idle.cutoff + REV_CUTOFF, fire + REV_UP);
    engine.filter.frequency.linearRampToValueAtTime(idle.cutoff, fire + REV_UP + REV_DOWN);
    engine.gain.gain.setValueAtTime(0, fire);
    engine.gain.gain.linearRampToValueAtTime(REV_GAIN, fire + REV_UP);
    engine.gain.gain.linearRampToValueAtTime(idle.gain, fire + REV_UP + REV_DOWN);
  }

  function suspend() {
    if (ctx) ctx.suspend();
  }

  function resume() {
    if (ctx) ctx.resume();
  }

  return { start, setEngine, thud, horn, ignition, suspend, resume };
}
