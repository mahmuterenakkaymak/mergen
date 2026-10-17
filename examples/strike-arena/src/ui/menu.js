// Start and pause overlays: title, buttons, the mouse sensitivity slider (persisted in
// localStorage under CONFIG.MENU.storageKey and restored on create) and the key help.
// Nothing here owns game state — every action leaves through a callback and main.js
// decides what Start or Resume does to the loop.
//
// The panels carry pointer-events:auto so they take clicks, while the empty #menu layer
// above the canvas stays click-through (index.html) once both panels are down.
import { CONFIG } from '../config.js';

const MENU = CONFIG.MENU;

const STEP = 0.05; // slider granularity; also the precision sensitivity is stored at

const KEYS = [
  ['WASD', 'Move'],
  ['Shift', 'Walk — quiet and accurate'],
  ['C / Ctrl', 'Crouch'],
  ['Space', 'Jump'],
  ['LMB', 'Fire'],
  ['RMB', 'Scope (sniper)'],
  ['1 / 2 / 3, wheel', 'Switch weapon'],
  ['R', 'Reload'],
  ['M', 'Mute'],
  ['Esc', 'Pause'],
];

function make(tag, className, css = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node.style, css);
  return node;
}

const clamp = (v) => Math.min(MENU.maxSensitivity, Math.max(MENU.minSensitivity, v));
const round2 = (v) => Math.round(v * 100) / 100;
const formatFactor = (v) => `${v.toFixed(2)}×`;

// Storage is best-effort: a blocked or full localStorage must not stop the menu building.
function readStored() {
  try {
    const raw = globalThis.localStorage?.getItem(MENU.storageKey);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? round2(clamp(value)) : MENU.defaultSensitivity;
  } catch {
    return MENU.defaultSensitivity;
  }
}

function writeStored(value) {
  try {
    globalThis.localStorage?.setItem(MENU.storageKey, String(value));
  } catch {
    /* persistence is a nicety, not a requirement to play */
  }
}

export function createMenu(root, { onStart, onResume, onSensitivity } = {}) {
  const layer = make('div', 'menu-root', {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    userSelect: 'none',
  });

  let sensitivity = readStored();
  let muted = false;

  // Both panels carry a slider, and both must show the one setting, so every control
  // registers here and `renderSensitivity` repaints them all.
  const controls = [];

  function makeSensitivityControl() {
    const row = make('div', 'menu-sens', {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontSize: '14px',
    });
    const name = make('span', 'menu-sens-name', { opacity: '0.8', minWidth: '130px' });
    name.textContent = 'Mouse sensitivity';
    const slider = make('input', 'menu-slider', { width: '180px', accentColor: '#8a933c' });
    slider.type = 'range';
    slider.min = String(MENU.minSensitivity);
    slider.max = String(MENU.maxSensitivity);
    slider.step = String(STEP);
    slider.setAttribute('aria-label', 'Mouse sensitivity');
    const value = make('span', 'menu-sens-value', {
      minWidth: '46px',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
    });
    row.append(name, slider, value);

    const commit = () => setSensitivity(Number.parseFloat(slider.value), { from: slider });
    slider.addEventListener('input', commit);
    slider.addEventListener('change', commit);

    const control = { row, slider, value };
    controls.push(control);
    return control;
  }

  function makeHelpPanel() {
    const panel = make('div', 'menu-help', {
      display: 'grid',
      gridTemplateColumns: 'auto auto',
      gap: '3px 14px',
      fontSize: '13px',
      padding: '12px 16px',
      border: '1px solid rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(0,0,0,0.35)',
      textAlign: 'left',
    });
    for (const [key, action] of KEYS) {
      const keyEl = make('div', 'menu-help-key', {
        fontWeight: '700',
        letterSpacing: '0.5px',
        color: '#c8d15e',
        whiteSpace: 'nowrap',
      });
      keyEl.textContent = key;
      const actionEl = make('div', 'menu-help-action', { opacity: '0.85' });
      actionEl.textContent = action;
      panel.append(keyEl, actionEl);
    }
    return panel;
  }

  function makePanel(className) {
    // Visibility goes through setPanelVisible(): the inline `display: flex` below would outrank
    // the browser's [hidden] rule, so hiding sets display too (2026-10-16: both panels stayed
    // on screen and the pause panel covered Start).
    const panel = make('div', className, {
      position: 'absolute',
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      padding: '24px',
      backgroundColor: 'rgba(6,8,10,0.82)',
      pointerEvents: 'auto',
      textAlign: 'center',
    });
    return panel;
  }

  function makeButton(label) {
    const button = make('button', 'menu-button', {
      font: 'inherit',
      fontSize: '16px',
      fontWeight: '700',
      letterSpacing: '2px',
      textTransform: 'uppercase',
      padding: '10px 34px',
      color: '#0d1117',
      backgroundColor: '#8a933c',
      border: '0',
      cursor: 'pointer',
    });
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  const startPanel = makePanel('menu-start');
  const title = make('div', 'menu-title', { fontSize: '52px', fontWeight: '800', letterSpacing: '10px' });
  title.textContent = 'STRIKE ARENA';
  const tagline = make('div', 'menu-tagline', { fontSize: '13px', letterSpacing: '3px', opacity: '0.6' });
  tagline.textContent = 'ONE ARENA · FIVE BOTS · NO ASSETS';
  const startButton = makeButton('Start');
  const startHint = make('div', 'menu-hint', { fontSize: '12px', opacity: '0.55' });
  startHint.textContent = 'Start locks the mouse — Esc gives it back.';
  startPanel.append(title, tagline, startButton, makeSensitivityControl().row, makeHelpPanel(), startHint);

  const pausePanel = makePanel('menu-pause');
  const pauseTitle = make('div', 'menu-title', { fontSize: '40px', fontWeight: '800', letterSpacing: '8px' });
  pauseTitle.textContent = 'PAUSED';
  const resumeButton = makeButton('Resume');
  pausePanel.append(pauseTitle, resumeButton, makeSensitivityControl().row, makeHelpPanel());

  // The mute readout lives outside the panels: M works in game, where the player needs it.
  const muteIndicator = make('div', 'menu-mute', {
    position: 'absolute',
    top: '14px',
    right: '18px',
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '2px',
    color: '#ff4d3d',
    pointerEvents: 'none',
  });
  muteIndicator.textContent = 'MUTED';

  layer.append(startPanel, pausePanel, muteIndicator);

  function renderSensitivity() {
    for (const control of controls) {
      control.slider.value = String(sensitivity);
      control.value.textContent = formatFactor(sensitivity);
    }
  }

  // `from` is the slider that triggered the change; re-rendering it mid-drag would snap
  // the thumb back to the old value on the very event that is moving it.
  function setSensitivity(next, { notify = true, persist = true, from = null } = {}) {
    const value = round2(clamp(Number.parseFloat(next)));
    if (!Number.isFinite(value)) return sensitivity;
    const changed = value !== sensitivity;
    sensitivity = value;
    if (changed) renderSensitivity();
    else if (from) from.value = String(value);
    if (!changed) return sensitivity;
    if (persist) writeStored(sensitivity);
    if (notify) onSensitivity?.(sensitivity);
    return sensitivity;
  }

  function setPanelVisible(panel, visible) {
    panel.hidden = !visible;
    panel.style.display = visible ? 'flex' : 'none';
  }
  function showStart() {
    setPanelVisible(startPanel, true);
  }
  function hideStart() {
    setPanelVisible(startPanel, false);
  }
  function showPause() {
    setPanelVisible(pausePanel, true);
  }
  function hidePause() {
    setPanelVisible(pausePanel, false);
  }

  startButton.addEventListener('click', () => {
    hideStart();
    onStart?.();
  });
  resumeButton.addEventListener('click', () => {
    hidePause();
    onResume?.();
  });

  renderSensitivity();
  muteIndicator.hidden = true;
  hidePause();
  showStart(); // a fresh menu always opens on the start screen
  if (root) root.appendChild(layer);

  return {
    el: layer,
    get sensitivity() {
      return sensitivity;
    },
    setSensitivity,
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = !!value;
      muteIndicator.hidden = !muted;
      return muted;
    },
    showStart,
    hideStart,
    showPause,
    hidePause,
    hideAll() {
      hideStart();
      hidePause();
    },
    get startVisible() {
      return !startPanel.hidden;
    },
    get pauseVisible() {
      return !pausePanel.hidden;
    },
    els: {
      startPanel,
      pausePanel,
      title,
      startButton,
      resumeButton,
      sliders: controls.map((control) => control.slider),
      sensValues: controls.map((control) => control.value),
      helpPanels: [startPanel, pausePanel].map((panel) => panel.querySelector('.menu-help')),
      muteIndicator,
    },
  };
}

export default createMenu;
