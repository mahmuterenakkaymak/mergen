// HUD: pure toast queue (frame-driven, no DOM, testable in Node) + createHud DOM builder.
import '../style.css';
import { damagePct } from './format.js';

// ASSUMPTION: default toast lifetime is the prototype's 1.6 s; the CSS opacity
// transition is the fade, so the queue only tracks visible/hidden per message.
const TOAST_SECONDS = 1.6;

// dt-driven queue: the current message shows for `seconds`, then the next queued
// one takes over. `step` runs once per frame from the game loop.
export function createToastQueue(seconds = TOAST_SECONDS) {
  const queue = [];
  let current = null;
  let remaining = 0;

  return {
    show(msg) {
      if (current === null) {
        current = msg;
        remaining = seconds;
      } else {
        queue.push(msg);
      }
    },
    step(dt) {
      if (current === null) return;
      remaining -= dt;
      if (remaining <= 0) {
        current = queue.length > 0 ? queue.shift() : null;
        remaining = seconds;
      }
    },
    get text() {
      return current;
    },
    get visible() {
      return current !== null;
    },
  };
}

const VIGNETTE_DECAY = 1.6; // per second: a full flash fades out in ~0.6 s (prototype's rate)
const FLASH_FLOOR = 6; // m/s: a hit at or below damage.js's damage floor must not flash
const FLASH_PER_MS = 0.048; // mirrors damage.js: 1.6 dmg * 0.03 flash per m/s over the floor
const WATCH_OUT_SECONDS = 3;
const WATCH_OUT_TOAST = 'WATCH OUT!';
const OVERHEAT_TOAST = 'ENGINE OVERHEATING — R TO REPAIR';
const RESET_TOAST = 'RESET — REPAIRED';
const STUCK_TOAST = 'STUCK? PRESS R';

// Red damage vignette: flashes on a hit, decays back to nothing; frame-rate independent.
export function createVignette() {
  let amount = 0;
  return {
    flash(a) {
      amount = Math.min(1, amount + a);
    },
    step(dt) {
      amount = Math.max(0, amount - VIGNETTE_DECAY * dt);
    },
    get amount() {
      return amount;
    },
  };
}

// Session top speed: the fastest the readout has shown since the page loaded. It lives
// with the HUD, not the sim, so an R rescue cannot wipe the session record. `record` holds
// for a moment after each new best, so the badge glows while the car is still climbing.
const RECORD_FLASH = 0.8; // s a new best keeps the badge lit
export function createTopSpeed() {
  let value = 0;
  let flash = 0;
  return {
    update(kmh, dt) {
      flash = Math.max(0, flash - dt);
      if (kmh > value) {
        value = kmh;
        flash = RECORD_FLASH;
      }
    },
    get value() {
      return value;
    },
    get record() {
      return flash > 0;
    },
  };
}

// The hint strip owns the first HINT_SECONDS of a session, then fades (the CSS opacity
// transition does the fade); F1 calls show() to bring it back for another stretch.
// ASSUMPTION: F1 re-shows the strip for a fresh HINT_SECONDS rather than pinning it on —
// the same promise the strip made when it first faded.
const HINT_SECONDS = 10;
export function createHint(seconds = HINT_SECONDS) {
  let elapsed = 0;
  return {
    step(dt) {
      elapsed += dt;
    },
    show() {
      elapsed = 0;
    },
    get visible() {
      return elapsed < seconds;
    },
  };
}

// Pure per-frame mapping: sim events -> HUD effects, no DOM. Returns the vignette flash
// to add this frame, the toasts to show, and the watchOut throttle time to pass back in
// next frame (`now` is seconds; keep it monotonic).
// ASSUMPTION: impact events carry only a speed, so its flash mirrors damage.js's rate;
// thud events already carry the flash damage.js computed, so those use it directly.
export function eventsToHud(events, now, lastWatchOut = -Infinity) {
  const out = { vignette: 0, toasts: [], lastWatchOut };
  let watchOut = false;
  for (const e of events) {
    if (e.type === 'impact' || e.type === 'thud') {
      out.vignette += typeof e.vignette === 'number'
        ? e.vignette
        : Math.max(0, Math.abs(e.speed) - FLASH_FLOOR) * FLASH_PER_MS;
      if (e.overheat) out.toasts.push(OVERHEAT_TOAST);
    } else if (e.type === 'watchOut') {
      watchOut = true;
    } else if (e.type === 'reset') {
      out.toasts.push(RESET_TOAST);
    } else if (e.type === 'stuck') {
      out.toasts.push(STUCK_TOAST);
    }
  }
  if (watchOut && now - lastWatchOut >= WATCH_OUT_SECONDS) {
    out.toasts.push(WATCH_OUT_TOAST);
    out.lastWatchOut = now;
  }
  return out;
}

// Builds the HUD overlay (speedometer, gear letter, damage bar, hint strip, toast) into doc.body.
export function createHud(doc) {
  const add = (id) => {
    const el = doc.createElement('div');
    el.id = id;
    el.className = 'hud';
    doc.body.appendChild(el);
    return el;
  };

  // atmospheric vignette first in DOM order, below the HUD (styled in style.css)
  const vignette = doc.createElement('div');
  vignette.id = 'vignette';
  doc.body.appendChild(vignette);

  // red damage flash, stacked above the dark one, still below the HUD
  const vignetteRed = doc.createElement('div');
  vignetteRed.id = 'vignetteRed';
  doc.body.appendChild(vignetteRed);

  // rescue blackout: the sim writes its opacity every frame, so it needs no CSS transition
  const fade = doc.createElement('div');
  fade.id = 'fade';
  doc.body.appendChild(fade);

  // pause dim: the sim holds behind it (game.js setPaused), so this overlay only has to be
  // readable and to invite the click back, which main.js listens for on pauseEl.
  const pause = doc.createElement('div');
  pause.id = 'pause';
  // Static markup, no user input.
  pause.innerHTML = '<div id="pauseTitle">PAUSED</div><div id="pauseSub">CLICK TO RESUME</div>';
  doc.body.appendChild(pause);

  const speedo = add('speedo');
  const gearEl = doc.createElement('div');
  gearEl.id = 'gear';
  gearEl.textContent = 'D';
  const speedLine = doc.createElement('div');
  const speedEl = doc.createElement('span');
  speedEl.id = 'speedNum';
  speedEl.textContent = '0';
  const unitEl = doc.createElement('span');
  unitEl.id = 'speedUnit';
  unitEl.textContent = 'KM/H';
  speedLine.append(speedEl, unitEl);
  speedo.append(gearEl, speedLine);

  // session top speed badge, above the speedometer; main.js feeds it the same tweened
  // number the big readout shows, so TOP never displays more than the player saw
  const topEl = add('topSpeed');
  const topNumEl = doc.createElement('span');
  topNumEl.id = 'topNum';
  topNumEl.textContent = '0';
  const topLbl = doc.createElement('span');
  topLbl.textContent = 'TOP ';
  topEl.append(topLbl, topNumEl);

  const dmgWrap = add('dmgWrap');
  const dmgLabel = doc.createElement('div');
  dmgLabel.id = 'dmgLabel';
  dmgLabel.textContent = 'DAMAGE';
  const dmgBar = doc.createElement('div');
  dmgBar.id = 'dmgBar';
  const dmgFill = doc.createElement('div');
  dmgFill.id = 'dmgFill';
  dmgBar.append(dmgFill);
  dmgWrap.append(dmgLabel, dmgBar);

  const hintEl = add('hint');
  // Static markup, no user input.
  hintEl.innerHTML =
    '<b>W A S D</b> drive · <b>SPACE</b> handbrake · <b>H</b> horn · <b>R</b> reset<br>' +
    '<b>DRAG</b> orbit cam · <b>WHEEL</b> zoom · <b>F1</b> hints';

  const toastEl = add('toast');

  return {
    speedEl,
    gearEl,
    hintEl,
    toastEl,
    pauseEl: pause,
    setSpeed(kmh, gear) {
      speedEl.textContent = kmh;
      gearEl.textContent = gear;
    },
    // The badge stays dark (opacity 0 in style.css) until the car has actually moved.
    setTop(kmh, record) {
      topNumEl.textContent = kmh;
      topEl.classList.toggle('show', kmh > 0);
      topEl.classList.toggle('record', record);
    },
    // The fade itself is the CSS opacity transition, so this is only a flip of the class.
    setHint(visible) {
      hintEl.classList.toggle('gone', !visible);
    },
    setDamage(damage) {
      dmgFill.style.width = `${damagePct(damage)}%`;
    },
    setVignette(amount) {
      vignetteRed.style.opacity = amount;
    },
    setFade(amount) {
      fade.style.opacity = amount;
    },
    // The dim itself is the CSS transition, so this is only a flip of the class.
    setPaused(on) {
      pause.classList.toggle('show', on);
    },
    // Keeps the last text while fading out so the message doesn't blank mid-transition.
    setToast(msg, visible) {
      if (msg) toastEl.textContent = msg;
      toastEl.classList.toggle('show', visible);
    },
  };
}
