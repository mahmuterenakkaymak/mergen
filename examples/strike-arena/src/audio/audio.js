// WebAudio shot synthesis. The AudioContext comes from an injected factory and is built
// lazily on unlock(), so tests run without a browser and the autoplay policy is satisfied
// by the Start click that calls unlock.
import { CONFIG } from '../config.js';

const RECIPES = CONFIG.AUDIO.shots;

// Click pitch and the extra layers are sound design rather than designer tunables, so they
// live here; everything a designer would rebalance is in CONFIG.AUDIO.shots.
const CLICK_HZ = { pistol: 2400, rifle: 2900, sniper: 1700 };
const CRACK = { gain: 0.25, decay: 0.05, type: 'highpass', hz: 4000 };
const SUB = { startHz: 60, endHz: 22, gain: 0.5, durationScale: 1.5 };

const EPS = 0.0001; // exponential ramps cannot target zero

function noiseSeconds() {
  return Math.max(0.2, ...Object.values(RECIPES).map((p) => p.duration)) + 0.1;
}

function makeNoiseBuffer(ctx) {
  const length = Math.max(1, Math.round(ctx.sampleRate * noiseSeconds()));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noiseBurst(a, p, t, opts = {}) {
  const gain = opts.gain ?? p.noiseGain;
  const decay = opts.decay ?? p.noiseDecay;

  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  const filter = a.ctx.createBiquadFilter();
  filter.type = opts.type ?? 'lowpass';
  filter.frequency.setValueAtTime(opts.hz ?? p.lowpassHz, t);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(EPS, t + decay);

  src.connect(filter);
  filter.connect(env);
  env.connect(a.master);
  src.start(t);
  src.stop(t + decay + 0.02);
}

function click(a, p, t, hz) {
  const osc = a.ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(hz, t);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(p.clickGain, t);
  env.gain.exponentialRampToValueAtTime(EPS, t + 0.012);

  osc.connect(env);
  env.connect(a.master);
  osc.start(t);
  osc.stop(t + 0.02);
}

function thump(a, p, t, opts = {}) {
  const startHz = opts.startHz ?? p.thumpStartHz;
  const endHz = opts.endHz ?? p.thumpEndHz;
  const gain = opts.gain ?? p.thumpGain;
  const dur = opts.duration ?? p.duration;

  const osc = a.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, t);
  osc.frequency.exponentialRampToValueAtTime(endHz, t + dur);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(EPS, t + dur);

  osc.connect(env);
  env.connect(a.master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// One layered recipe per weapon: noise burst + click transient + lowpass + pitch-swept thump,
// with a rifle crack layer and a sniper sub layer on top of the shared skeleton.
export const SHOT_GENERATORS = {
  pistol(a, p, t) {
    noiseBurst(a, p, t);
    click(a, p, t, CLICK_HZ.pistol);
    thump(a, p, t);
  },
  rifle(a, p, t) {
    noiseBurst(a, p, t);
    noiseBurst(a, p, t, CRACK);
    click(a, p, t, CLICK_HZ.rifle);
    thump(a, p, t);
  },
  sniper(a, p, t) {
    noiseBurst(a, p, t);
    click(a, p, t, CLICK_HZ.sniper);
    thump(a, p, t);
    thump(a, p, t, { ...SUB, duration: p.duration * SUB.durationScale });
  },
};

// --- part 2: reload, footsteps, hit feedback, stingers, positional bot fire -----------

// Mechanical clicks (mag, slide, empty chamber) and footstep scrapes: a filtered noise
// burst with a short blip on top. Sound design rather than designer tunables, like the
// shot layers above.
const MECHANICAL = {
  magOut: { hz: 900, gain: 0.3, decay: 0.05, blipHz: 1400, blipGain: 0.16 },
  magIn: { hz: 620, gain: 0.36, decay: 0.07, blipHz: 980, blipGain: 0.2 },
  slide: { hz: 1500, gain: 0.3, decay: 0.045, blipHz: 2100, blipGain: 0.18 },
  dryFire: { hz: 1200, gain: 0.18, decay: 0.02, blipHz: 700, blipGain: 0.1 },
};

const FOOTSTEP_SURFACES = {
  concrete: { hz: 420, gain: 0.2, decay: 0.09 },
  metal: { hz: 1500, gain: 0.18, decay: 0.12 },
  wood: { hz: 700, gain: 0.19, decay: 0.1 },
};
const DEFAULT_SURFACE = 'concrete';

// Hit feedback has to read through gunfire, so it sits high and thin: a plain ping for
// body, a rising two-tone ding for the headshot reward.
const HIT_TONES = {
  body: [{ hz: 1180, gain: 0.3, decay: 0.07 }],
  headshot: [
    { hz: 1560, gain: 0.3, decay: 0.06 },
    { hz: 2340, gain: 0.26, decay: 0.09, delay: 0.05 },
  ],
};

const ROUND_STINGER = {
  won: [
    { hz: 440, gain: 0.3, decay: 0.16 },
    { hz: 554, gain: 0.3, decay: 0.16, delay: 0.11 },
    { hz: 659, gain: 0.34, decay: 0.3, delay: 0.22 },
  ],
  lost: [
    { hz: 392, gain: 0.3, decay: 0.16 },
    { hz: 330, gain: 0.3, decay: 0.16, delay: 0.13 },
    { hz: 262, gain: 0.34, decay: 0.34, delay: 0.26 },
  ],
};

// Footstep events carry speedRatio against runSpeed; at or below the walk key's own ratio
// the player is quiet-stepping, and his steps should not be heard at all.
const WALK_RATIO = CONFIG.MOVEMENT.walkSpeed / CONFIG.MOVEMENT.runSpeed;

function blip(a, t, { hz, gain, decay, type = 'sine' }) {
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(EPS, t + decay);

  osc.connect(env);
  env.connect(a.master);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}

function mechanical(a, t, spec) {
  noiseBurst(a, spec, t, { ...spec, type: 'bandpass' });
  blip(a, t, { hz: spec.blipHz, gain: spec.blipGain, decay: 0.012 });
}

function notes(a, t, list) {
  for (const note of list) blip(a, t + (note.delay ?? 0), { ...note, type: 'triangle' });
}

// setPosition is the form every target still implements; the AudioParam trio is the
// fallback for a context that has dropped it.
function place(node, pos) {
  if (typeof node.setPosition === 'function') {
    node.setPosition(pos.x, pos.y, pos.z);
    return;
  }
  node.positionX.value = pos.x;
  node.positionY.value = pos.y;
  node.positionZ.value = pos.z;
}

// A footstep is quiet when the player crouches or holds walk, whichever the event says.
function isQuietStep(event) {
  return !!event.crouched || (event.speedRatio ?? 1) <= WALK_RATIO + 1e-9;
}

export function createAudio(ctxFactory) {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;

  function applyMasterGain() {
    if (master) master.gain.value = muted ? 0 : CONFIG.AUDIO.masterVolume;
  }

  const api = {
    get ctx() {
      return ctx;
    },
    get master() {
      return master;
    },
    get noiseBuffer() {
      return noise;
    },
    get muted() {
      return muted;
    },

    // Safe to call on every Start/Resume: the context is built once, then merely resumed.
    unlock() {
      if (!ctx) {
        ctx = ctxFactory();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noise = makeNoiseBuffer(ctx);
        applyMasterGain();
      }
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') ctx.resume();
      return ctx;
    },

    setMuted(value) {
      muted = !!value;
      applyMasterGain();
      return muted;
    },

    toggleMute() {
      return this.setMuted(!muted);
    },

    playShot(weaponName) {
      const generator = SHOT_GENERATORS[weaponName];
      const params = RECIPES[weaponName];
      if (!ctx || !generator || !params) return false;
      generator({ ctx, master, noise }, params, ctx.currentTime);
      return true;
    },

    playReload(stage = 'magOut') {
      const spec = MECHANICAL[stage];
      if (!ctx || !spec) return false;
      mechanical({ ctx, master, noise }, ctx.currentTime, spec);
      return true;
    },

    playFootstep(surface = DEFAULT_SURFACE, walking = false) {
      if (walking || !ctx) return false;
      const spec = FOOTSTEP_SURFACES[surface] ?? FOOTSTEP_SURFACES[DEFAULT_SURFACE];
      const a = { ctx, master, noise };
      const t = ctx.currentTime;
      noiseBurst(a, spec, t, { ...spec, type: 'bandpass' });
      blip(a, t, { hz: 110, gain: spec.gain * 0.5, decay: spec.decay * 0.8 });
      return true;
    },

    playHit(headshot = false) {
      if (!ctx) return false;
      const tones = headshot ? HIT_TONES.headshot : HIT_TONES.body;
      notes({ ctx, master, noise }, ctx.currentTime, tones);
      return true;
    },

    playDryFire() {
      if (!ctx) return false;
      mechanical({ ctx, master, noise }, ctx.currentTime, MECHANICAL.dryFire);
      return true;
    },

    playRoundEnd(won) {
      if (!ctx) return false;
      const stinger = won ? ROUND_STINGER.won : ROUND_STINGER.lost;
      notes({ ctx, master, noise }, ctx.currentTime, stinger);
      return true;
    },

    // Bot gunfire is the only sound placed in the room: the panner carries both the
    // stereo image and the distance falloff, so a shot behind you at 40 m arrives quiet
    // and in the wrong ear.
    playBotShot(pos, weaponName = 'rifle') {
      const generator = SHOT_GENERATORS[weaponName];
      const params = RECIPES[weaponName];
      if (!ctx || !pos || !generator || !params) return false;

      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = CONFIG.AUDIO.refDistance;
      panner.maxDistance = CONFIG.AUDIO.maxDistance;
      panner.rolloffFactor = CONFIG.AUDIO.rolloffFactor;
      place(panner, pos);
      panner.connect(master);

      generator({ ctx, master: panner, noise }, params, ctx.currentTime);
      return true;
    },

    // yaw 0 looks toward -Z, the core's own convention.
    setListener(pos, yaw) {
      if (!ctx || !pos) return false;
      const listener = ctx.listener;
      place(listener, pos);

      const forward = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      if (typeof listener.setOrientation === 'function') {
        listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
        return true;
      }
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
      return true;
    },

    handleEvents(events) {
      let played = 0;
      for (const event of events ?? []) if (handleEvent(event)) played += 1;
      return played;
    },
  };

  function handleEvent(event) {
    switch (event?.type) {
      case 'shot':
        return api.playShot(event.weapon);
      case 'botShot':
        return api.playBotShot(event.pos, event.weapon);
      case 'hit':
        return api.playHit(event.kind === 'head');
      case 'dryFire':
        return api.playDryFire();
      case 'reloadStart':
        return api.playReload('magOut');
      case 'reloadEnd':
        return api.playReload('magIn');
      case 'footstep':
        return api.playFootstep(DEFAULT_SURFACE, isQuietStep(event));
      case 'roundEnd':
        return api.playRoundEnd(event.result === 'won');
      default:
        return false;
    }
  }

  return api;
}

export default createAudio;
