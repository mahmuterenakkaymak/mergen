// Pure input state. attachInput (DOM) writes into it, the sim reads it — no DOM here.
// Drag and wheel accumulators are drained once per frame by takeOrbit/takeZoom;
// clamping pitch and distance is the camera's job, not the input's.

const YAW_SENS = 0.005;   // rad per px of horizontal drag
const PITCH_SENS = 0.004; // rad per px of vertical drag
const ZOOM_SENS = 0.01;   // camera metres per wheel notch

const DOWN = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};
const EDGE = ['KeyH', 'KeyR', 'KeyP', 'Escape', 'F1'];
const TRACKED = new Set([...Object.values(DOWN).flat(), ...EDGE]);

export function createInputState() {
  return { keys: new Set(), pressed: new Set(), dragX: 0, dragY: 0, wheel: 0, pointerLock: false };
}

export function keyDown(state, e) {
  const code = e.code;
  if (!TRACKED.has(code)) return;
  if (!e.repeat && !state.keys.has(code)) state.pressed.add(code);
  state.keys.add(code);
}

export function keyUp(state, e) {
  state.keys.delete(e.code);
}

// Edge trigger: true only on the frame the key went down; endFrame() clears them all.
export function isPressed(state, code) {
  return state.pressed.has(code);
}

export function endFrame(state) {
  state.pressed.clear();
}

export function toControls(state) {
  const on = (action) => (DOWN[action].some((c) => state.keys.has(c)) ? 1 : 0);
  return {
    throttle: on('throttle'),
    brake: on('brake'),
    steer: on('left') - on('right'), // ASSUMPTION: prototype sign, A/left is +1
    handbrake: on('handbrake'),
  };
}

// Mouse-look mode: P flips it, and the drag path stays the fallback for when the lock
// is denied or unsupported. Pure flip — attachInput follows it on the DOM side.
// clearAll leaves it alone: a mode, not a held key, and a blur keeps the lock.
export function togglePointerLock(state) {
  state.pointerLock = !state.pointerLock;
  return state.pointerLock;
}

export function addDrag(state, dx, dy) {
  state.dragX += dx;
  state.dragY += dy;
}

export function takeOrbit(state) {
  const out = { yaw: -state.dragX * YAW_SENS, pitch: state.dragY * PITCH_SENS };
  state.dragX = 0;
  state.dragY = 0;
  return out;
}

export function addWheel(state, deltaY) {
  state.wheel += deltaY;
}

export function takeZoom(state) {
  const out = state.wheel * ZOOM_SENS;
  state.wheel = 0;
  return out;
}

export function clearAll(state) {
  state.keys.clear();
  state.pressed.clear();
  state.dragX = 0;
  state.dragY = 0;
  state.wheel = 0;
}

// Arrows and Space would scroll the page instead of driving the car.
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

// ASSUMPTION: target is the event host the game listens on (window, as in the prototype), so
// keys work without focusing the canvas; blur is watched on window, where it actually fires.
export function attachInput(target, state) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // Pointer lock is requested on an element and target is window; body is the natural
  // host. Absent under Node, where the P toggle stays pure state.
  const doc = typeof document !== 'undefined' ? document : null;
  const setLock = (on) => {
    if (!doc) return;
    if (on) {
      const p = doc.body.requestPointerLock?.();
      if (p?.catch) p.catch(() => { state.pointerLock = false; });
    } else {
      doc.exitPointerLock?.();
    }
  };
  // The browser takes the lock back on its own (Esc), so reality, not the toggle,
  // is the truth: these two keep state.pointerLock in step with it.
  const onLockChange = () => { state.pointerLock = doc.pointerLockElement != null; };
  const onLockError = () => { state.pointerLock = false; };

  const onKeyDown = (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    keyDown(state, e);
    // ASSUMPTION: P is consumed here, in the DOM binding — pointer lock is an input
    // mode, not game state, so the sim never sees it.
    if (e.code === 'KeyP' && !e.repeat) setLock(togglePointerLock(state));
  };
  const onKeyUp = (e) => keyUp(state, e);
  const onPointerDown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerMove = (e) => {
    if (state.pointerLock) {
      // While locked the cursor is pinned, so clientX/Y stand still; movementX/Y are
      // the deltas of the motion itself.
      addDrag(state, e.movementX || 0, e.movementY || 0);
      return;
    }
    if (!dragging) return;
    addDrag(state, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerEnd = () => {
    dragging = false;
  };
  const onWheel = (e) => addWheel(state, e.deltaY);
  // A window blur swallows the pointerup that would end the drag, so end it here too:
  // otherwise plain mouse movement keeps orbiting the camera until the next click.
  const onBlur = () => {
    dragging = false;
    clearAll(state);
  };

  const blurHost = typeof window !== 'undefined' ? window : target;

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerEnd);
  target.addEventListener('pointercancel', onPointerEnd);
  target.addEventListener('wheel', onWheel, { passive: true });
  blurHost.addEventListener('blur', onBlur);
  doc?.addEventListener('pointerlockchange', onLockChange);
  doc?.addEventListener('pointerlockerror', onLockError);

  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', onPointerEnd);
    target.removeEventListener('pointercancel', onPointerEnd);
    target.removeEventListener('wheel', onWheel);
    blurHost.removeEventListener('blur', onBlur);
    doc?.removeEventListener('pointerlockchange', onLockChange);
    doc?.removeEventListener('pointerlockerror', onLockError);
  };
}
