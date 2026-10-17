// Session wiring: what stands between the player and the simulation. The start screen, the
// pause (Esc, a lost pointer lock, a window blur), the mute key, the sensitivity slider, and
// the fan-out of each tick's events to the layers that react to moments instead of state.
// Every collaborator is injected, so the whole state machine runs headless in a test.
import { runFrame } from './core/game.js';

// lockTarget is the canvas: pointer lock is only ever taken over the render surface, and a
// click on it re-arms a request the browser may have refused.
export function createSession({
  world,
  input,
  loop,
  menu,
  audio,
  effects,
  lockTarget = null,
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
}) {
  let started = false;
  let paused = true; // the start screen holds the world still until Start
  // Input edges already acted on, so one Esc cannot pause twice.
  const acted = new Set();

  const hasLock = () => !!doc && doc.pointerLockElement === lockTarget;

  // Pointer lock is refused as often as it is granted — no user gesture, a denial a few
  // seconds old — and an uncaught rejection from it is a console error on every click.
  function requestLock() {
    if (!lockTarget?.requestPointerLock) return;
    const result = lockTarget.requestPointerLock();
    result?.catch?.(() => {});
  }

  function releaseLock() {
    if (hasLock() && typeof doc.exitPointerLock === 'function') doc.exitPointerLock();
  }

  function pause() {
    if (paused) return false;
    paused = true;
    loop.reset(); // the seconds spent reading the menu are not catch-up work
    releaseLock();
    menu.showPause();
    return true;
  }

  function resume() {
    if (!started || !paused) return false;
    paused = false;
    loop.reset();
    menu.hidePause();
    audio.unlock(); // the AudioContext may have been suspended while we were away
    requestLock();
    return true;
  }

  // Only ever reached from the Start button, which is the user gesture both the pointer lock
  // and the AudioContext need.
  function start() {
    started = true;
    paused = false;
    loop.reset();
    menu.hideStart();
    audio.unlock();
    requestLock();
  }

  // Esc on the start screen does nothing: resuming there would take the mouse without the
  // player having asked for the game.
  function togglePause() {
    if (!started) return false;
    return paused ? resume() : pause();
  }

  function toggleMute() {
    menu.setMuted(audio.toggleMute());
  }

  // The one setting the core never sees: it scales the mouse delta on its way out of
  // input.js, so it belongs to the input and not to the world.
  function setSensitivity(value) {
    input.sensitivity = value;
    return input.sensitivity;
  }

  // An edge outlives the frame that produced it: input.endFrame() only runs on a frame that
  // actually stepped, so an Esc landing on a 0-step frame is still "pressed" on the next one
  // and would toggle the pause straight back off. Each edge is therefore acted on once, and
  // becomes eligible again once the input has spent it. Returns whether anything was acted
  // on, so the caller knows whether it is worth looking for a spent edge this frame.
  function drainEdges() {
    const edges = input.snapshot().pressed ?? {};
    let actedOn = false;
    for (const [action, isEdge] of Object.entries(edges)) {
      if (!isEdge) {
        acted.delete(action);
        continue;
      }
      if (acted.has(action)) continue;
      acted.add(action);
      actedOn = true;
      if (action === 'pause') togglePause();
      else if (action === 'mute') toggleMute();
    }
    return actedOn;
  }

  // A frame that stepped has spent every edge the input was holding, so a key pressed again
  // inside the same frame is a fresh press and not the one just acted on.
  function rearmSpentEdges() {
    const edges = input.snapshot().pressed ?? {};
    for (const action of acted) if (!edges[action]) acted.delete(action);
  }

  // One rendered frame: advance the simulation if the session is running, hand the tick's
  // events to the layers that want moments, and return them for the caller's own reactions.
  function step(frameDt) {
    const actedOn = drainEdges();

    if (paused) {
      // Nothing stepped, so nothing else will clear the frame-scoped input — a mouse dragged
      // across the pause menu would otherwise land as one enormous look jump on resume. With
      // the edges spent, every one of them is eligible again next frame.
      input.endFrame();
      acted.clear();
      return [];
    }

    const events = runFrame(world, input, loop, frameDt);
    if (actedOn) rearmSpentEdges();
    // A bot's shot is placed by a PannerNode, so it is panned and attenuated against the
    // WebAudio listener — which sits at the origin facing -Z until it is told otherwise,
    // making every firefight sound like it is happening at the map centre. The ear has to be
    // the eye the camera uses, or sound and picture disagree about where the player is.
    const player = world.player;
    const box = player.box;
    audio.setListener(
      {
        x: (box.min.x + box.max.x) / 2,
        y: box.min.y + player.eyeY,
        z: (box.min.z + box.max.z) / 2,
      },
      player.yaw,
    );
    audio.handleEvents(events);
    effects.handleEvents(events);
    return events;
  }

  // The browser takes the mouse back the moment the tab loses focus or the player alt-tabs,
  // so both are a pause rather than a moment of uncontrollable aim on return.
  const onPointerLockChange = () => {
    if (!hasLock()) pause();
  };
  const onBlur = () => pause();
  const onCanvasClick = () => {
    if (!paused && !hasLock()) requestLock();
  };

  doc?.addEventListener('pointerlockchange', onPointerLockChange);
  win?.addEventListener('blur', onBlur);
  lockTarget?.addEventListener('click', onCanvasClick);

  return {
    step,
    start,
    pause,
    resume,
    togglePause,
    toggleMute,
    setSensitivity,
    get paused() {
      return paused;
    },
    get started() {
      return started;
    },
    get muted() {
      return audio.muted;
    },
    destroy() {
      doc?.removeEventListener('pointerlockchange', onPointerLockChange);
      win?.removeEventListener('blur', onBlur);
      lockTarget?.removeEventListener('click', onCanvasClick);
    },
  };
}

export default createSession;
