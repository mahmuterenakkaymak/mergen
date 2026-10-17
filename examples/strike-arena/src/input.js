// Captures DOM input and turns it into plain per-frame snapshots, so src/core/ never
// sees an event object. Listeners sit on the window (derived from `target`): keyboard
// events never reach a canvas element, and mouse events during pointer lock are
// delivered to the document anyway.
//
// snapshot().mouseX/mouseY are ALREADY multiplied by `sensitivity` — pass 1 as the
// sensitivity argument to movement.applyLook, or the look speed doubles.
import { MENU } from './config.js';

const ACTIONS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyR: 'reload',
  KeyM: 'mute',
  Digit1: 'slot1',
  Numpad1: 'slot1',
  Digit2: 'slot2',
  Numpad2: 'slot2',
  Digit3: 'slot3',
  Numpad3: 'slot3',
  Escape: 'pause',
};

const MOUSE_BUTTONS = { 0: 'fire', 2: 'ads' };

const ACTION_NAMES = [...new Set([...Object.values(ACTIONS), ...Object.values(MOUSE_BUTTONS)])];

const blankFlags = () => Object.fromEntries(ACTION_NAMES.map((name) => [name, false]));

// Keys must not be swallowed while the player is typing in or arrowing through a menu
// control (the sensitivity slider, for instance).
const isEditing = (event) => {
  const node = event.target;
  if (!node || typeof node.tagName !== 'string') return false;
  return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
};

const windowOf = (target) => target?.defaultView ?? target?.ownerDocument?.defaultView ?? target;

export function createInput(target = typeof window === 'undefined' ? null : window, options = {}) {
  const scope = windowOf(target);
  let sensitivity =
    Number.isFinite(options.sensitivity) && options.sensitivity > 0 ? options.sensitivity : MENU.defaultSensitivity;

  // Held state is tracked per physical key/button, not per action: C and Ctrl both
  // crouch, and releasing one must not cancel the other.
  const codes = new Set();
  const buttons = new Set();
  const pressed = new Set();
  let mouseX = 0;
  let mouseY = 0;
  let wheel = 0;

  const onKeyDown = (event) => {
    const code = event.code;
    const action = ACTIONS[code];
    if (!action || isEditing(event) || codes.has(code)) return;
    event.preventDefault(); // Space and the arrows would otherwise scroll the page
    codes.add(code);
    pressed.add(action);
  };
  const onKeyUp = (event) => codes.delete(event.code);
  const onMouseDown = (event) => {
    const action = MOUSE_BUTTONS[event.button];
    if (!action || buttons.has(event.button)) return;
    buttons.add(event.button);
    pressed.add(action);
  };
  const onMouseUp = (event) => buttons.delete(event.button);
  const onMouseMove = (event) => {
    mouseX += (event.movementX || 0) * sensitivity;
    mouseY += (event.movementY || 0) * sensitivity;
  };
  const onWheel = (event) => {
    if (event.deltaY) wheel += Math.sign(event.deltaY);
  };
  const onBlur = () => {
    codes.clear(); // tabbing away must not leave a key stuck down
    buttons.clear();
  };
  const onContextMenu = (event) => event.preventDefault();

  const handlers = {
    keydown: onKeyDown,
    keyup: onKeyUp,
    mousedown: onMouseDown,
    mouseup: onMouseUp,
    mousemove: onMouseMove,
    wheel: onWheel,
    blur: onBlur,
    contextmenu: onContextMenu,
  };
  if (scope) {
    for (const [type, handler] of Object.entries(handlers)) scope.addEventListener(type, handler);
  }

  return {
    snapshot() {
      const flags = blankFlags();
      for (const code of codes) flags[ACTIONS[code]] = true;
      for (const button of buttons) flags[MOUSE_BUTTONS[button]] = true;
      const edges = blankFlags();
      for (const action of pressed) edges[action] = true;
      return { ...flags, wheel, mouseX, mouseY, pressed: edges };
    },

    // Called once per rendered frame, after snapshot(): clears everything that is
    // frame-scoped (mouse delta, wheel, pressed edges) and keeps the held state.
    endFrame() {
      mouseX = 0;
      mouseY = 0;
      wheel = 0;
      pressed.clear();
    },

    get sensitivity() {
      return sensitivity;
    },
    set sensitivity(value) {
      if (Number.isFinite(value) && value > 0) sensitivity = value;
    },

    destroy() {
      if (!scope) return;
      for (const [type, handler] of Object.entries(handlers)) scope.removeEventListener(type, handler);
    },
  };
}
