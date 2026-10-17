// DOM HUD. createHud(root) builds every element once and returns an update(view) that
// writes a plain state snapshot into them each frame; nothing here owns game state, and
// hits arrive through showHitmarker rather than through the view (they are moments, not
// state), and so do kills and wounds through showKill / showDamageIndicator — each owns
// its own expiry timer.
//
// view = {
//   health, weaponName, mag, reserve,
//   score: { player, bots }, roundTime (seconds, counts up), fps,
//   crosshairRadius (px, from spread.crosshairRadius), scoped,
//   reloading, reloadProgress (0..1),
//   roundPhase ('playing' | 'won' | 'lost'), roundCountdown (seconds until the next round)
// }
// Every field is optional: an update that omits one leaves that readout as it was.
import { CONFIG } from '../config.js';

const LINE_THICKNESS = 2; // px
const HITMARKER_ARM = 9; // px, half-length of each hitmarker bar
const BODY_COLOR = '#ffffff';
const HEADSHOT_COLOR = '#ff4d3d';
const DAMAGE_COLOR = 'rgba(255,70,50,0.9)';
const HEADSHOT_ICON = '✷'; // kill feed marker for a headshot
const INDICATOR_RADIUS = 130; // px from the screen centre the damage arc sits at
const INDICATOR_BAR = 30; // px, width of the damage arc
const VIGNETTE_MAX = 0.6; // vignette opacity at zero health

function make(tag, className, css = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node.style, css);
  return node;
}

const when = (value, format) => (value === undefined || value === null ? undefined : format(value));
const set = (node, value) => {
  if (value !== undefined) node.textContent = String(value);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// m:ss, floored and clamped at zero so a paused or negative timer never renders "-0:01".
function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function createHud(root) {
  const layer = make('div', 'hud-root', {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    userSelect: 'none',
  });

  // --- top centre: score + round timer
  const top = make('div', 'hud-top', {
    position: 'absolute',
    top: '14px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    textAlign: 'center',
  });
  const score = make('div', 'hud-score', { fontSize: '18px', fontWeight: '700', letterSpacing: '2px' });
  const scorePlayer = make('span', 'hud-score-player');
  const scoreSep = make('span', 'hud-score-sep', { margin: '0 8px', opacity: '0.5' });
  const scoreBots = make('span', 'hud-score-bots');
  scoreSep.textContent = ':';
  score.append(scorePlayer, scoreSep, scoreBots);
  const timer = make('div', 'hud-timer', {
    fontSize: '26px',
    fontWeight: '700',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  });
  top.append(score, timer);

  // --- bottom left: health, then weapon + ammo
  const panel = make('div', 'hud-panel', {
    position: 'absolute',
    left: '22px',
    bottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  });
  const health = make('div', 'hud-health', { fontSize: '34px', fontWeight: '800', fontVariantNumeric: 'tabular-nums' });
  const weaponRow = make('div', 'hud-weapon-row', { fontSize: '16px', display: 'flex', gap: '10px', alignItems: 'baseline' });
  const weapon = make('span', 'hud-weapon', {
    fontWeight: '600',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    opacity: '0.9',
  });
  const ammo = make('span', 'hud-ammo', { fontVariantNumeric: 'tabular-nums' });
  const mag = make('b', 'hud-mag', { fontSize: '20px' });
  const ammoSep = make('span', 'hud-ammo-sep', { margin: '0 4px', opacity: '0.5' });
  const reserve = make('span', 'hud-reserve', { opacity: '0.75' });
  ammoSep.textContent = '/';
  ammo.append(mag, ammoSep, reserve);
  weaponRow.append(weapon, ammo);
  panel.append(health, weaponRow);

  const fpsEl = make('div', 'hud-fps', {
    position: 'absolute',
    top: '14px',
    left: '18px',
    fontSize: '13px',
    opacity: '0.7',
    fontVariantNumeric: 'tabular-nums',
  });

  // --- crosshair: four lines whose inner edge sits `radius` px from the centre, so the
  // drawn gap is where the shots actually go.
  const crosshair = make('div', 'hud-crosshair', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '0',
    height: '0',
  });
  const crosshairLines = {};
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const vertical = side === 'top' || side === 'bottom';
    crosshairLines[side] = make('div', `hud-crosshair-${side}`, {
      position: 'absolute',
      left: vertical ? `${-LINE_THICKNESS / 2}px` : '0',
      top: vertical ? '0' : `${-LINE_THICKNESS / 2}px`,
      width: `${vertical ? LINE_THICKNESS : CONFIG.HUD.crosshairLength}px`,
      height: `${vertical ? CONFIG.HUD.crosshairLength : LINE_THICKNESS}px`,
      backgroundColor: 'rgba(255,255,255,0.9)',
      boxShadow: '0 0 2px rgba(0,0,0,0.8)',
    });
  }
  crosshair.append(crosshairLines.top, crosshairLines.bottom, crosshairLines.left, crosshairLines.right);

  function setCrosshairGap(radius) {
    const gap = Math.max(0, radius * CONFIG.HUD.crosshairGapScale);
    const len = CONFIG.HUD.crosshairLength;
    crosshairLines.top.style.top = `${-(gap + len)}px`;
    crosshairLines.bottom.style.top = `${gap}px`;
    crosshairLines.left.style.left = `${-(gap + len)}px`;
    crosshairLines.right.style.left = `${gap}px`;
  }

  // --- sniper scope overlay: black everywhere but a clear disc, with a thin reticle.
  const scope = make('div', 'hud-scope', {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 34%, #000 46%)',
  });
  for (const deg of [0, 90]) {
    scope.append(
      make('div', 'hud-scope-reticle', {
        position: 'absolute',
        left: '0',
        top: '50%',
        width: '100%',
        height: '1px',
        backgroundColor: 'rgba(0,0,0,0.8)',
        transform: `rotate(${deg}deg)`,
      }),
    );
  }

  // --- hitmarker: two crossed bars, red for a headshot.
  const hitmarker = make('div', 'hud-hitmarker', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '0',
    height: '0',
  });
  const hitmarkerArms = [45, -45].map((deg) =>
    make('div', 'hud-hitmarker-arm', {
      position: 'absolute',
      left: `${-HITMARKER_ARM}px`,
      top: `${-LINE_THICKNESS / 2}px`,
      width: `${HITMARKER_ARM * 2}px`,
      height: `${LINE_THICKNESS}px`,
      backgroundColor: BODY_COLOR,
      transform: `rotate(${deg}deg)`,
      boxShadow: '0 0 3px rgba(0,0,0,0.9)',
    }),
  );
  hitmarker.append(...hitmarkerArms);

  // --- reload progress bar
  const reload = make('div', 'hud-reload', {
    position: 'absolute',
    left: '50%',
    bottom: '18%',
    width: '170px',
    marginLeft: '-85px',
    height: '5px',
    backgroundColor: 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(255,255,255,0.35)',
  });
  const reloadFill = make('div', 'hud-reload-fill', {
    height: '100%',
    width: '0%',
    backgroundColor: 'rgba(255,255,255,0.85)',
  });
  reload.append(reloadFill);

  // --- kill feed: newest entry on top, each one on its own expiry timer.
  const killFeed = make('div', 'hud-killfeed', {
    position: 'absolute',
    top: '48px',
    right: '18px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '3px',
    fontSize: '13px',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  });
  const killFeedTimers = new Map();

  // --- damage direction: an arc pointing back at the shooter, rotated about the crosshair.
  const damageIndicator = make('div', 'hud-damage', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '0',
    height: '0',
  });
  damageIndicator.append(
    make('div', 'hud-damage-arc', {
      position: 'absolute',
      left: `${-INDICATOR_BAR / 2}px`,
      top: `${-INDICATOR_RADIUS}px`,
      width: `${INDICATOR_BAR}px`,
      height: `${INDICATOR_BAR / 2}px`,
      backgroundColor: DAMAGE_COLOR,
      // only the top edge of the box is painted, so the arc reads as a chevron
      clipPath: 'polygon(0 100%, 50% 0, 100% 100%)',
    }),
  );

  // --- round banner: the result of the round plus the countdown to the next one.
  const banner = make('div', 'hud-banner', {
    position: 'absolute',
    left: '50%',
    top: '30%',
    transform: 'translateX(-50%)',
    textAlign: 'center',
    textShadow: '0 2px 8px rgba(0,0,0,0.9)',
  });
  const bannerText = make('div', 'hud-banner-text', {
    fontSize: '40px',
    fontWeight: '800',
    letterSpacing: '4px',
  });
  const bannerCountdown = make('div', 'hud-banner-countdown', {
    fontSize: '18px',
    fontWeight: '600',
    letterSpacing: '1px',
    opacity: '0.8',
    fontVariantNumeric: 'tabular-nums',
  });
  banner.append(bannerText, bannerCountdown);

  // --- low-health vignette and the death overlay that replaces it. Both are full-screen,
  // so neither may take pointer events: the click that re-locks the mouse has to reach the
  // canvas underneath.
  const vignette = make('div', 'hud-vignette', {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    pointerEvents: 'none',
    background: 'radial-gradient(circle at 50% 50%, rgba(150,0,0,0) 42%, rgba(150,0,0,1) 100%)',
    opacity: '0',
  });
  const deathOverlay = make('div', 'hud-death', {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    pointerEvents: 'none',
    background: 'rgba(24,0,0,0.6)',
  });
  const deathText = make('div', 'hud-death-text', {
    position: 'absolute',
    left: '50%',
    top: '42%',
    transform: 'translate(-50%, -50%)',
    fontSize: '44px',
    fontWeight: '800',
    letterSpacing: '6px',
    color: HEADSHOT_COLOR,
    textShadow: '0 2px 10px rgba(0,0,0,0.9)',
  });
  deathText.textContent = 'YOU ARE DEAD';
  deathOverlay.append(deathText);

  // Visibility is toggled through the `hidden` attribute, and none of these elements gets
  // an inline `display`: an inline display would outrank the browser's [hidden] rule and
  // leave them permanently visible.
  setCrosshairGap(0);
  crosshair.hidden = false;
  scope.hidden = true;
  hitmarker.hidden = true;
  reload.hidden = true;
  damageIndicator.hidden = true;
  banner.hidden = true;
  vignette.hidden = true;
  deathOverlay.hidden = true;

  layer.append(
    top,
    panel,
    fpsEl,
    vignette,
    crosshair,
    scope,
    hitmarker,
    reload,
    killFeed,
    damageIndicator,
    banner,
    deathOverlay,
  );

  let hitmarkerTimer = null;
  let damageTimer = null;

  function hideHitmarker() {
    if (hitmarkerTimer !== null) {
      clearTimeout(hitmarkerTimer);
      hitmarkerTimer = null;
    }
    hitmarker.hidden = true;
  }

  // Called once per confirmed hit; a fresh hit restarts the countdown instead of stacking
  // timers, so a rifle burst keeps the marker up until the last shot lands.
  function showHitmarker({ headshot = false } = {}) {
    const color = headshot ? HEADSHOT_COLOR : BODY_COLOR;
    for (const arm of hitmarkerArms) arm.style.backgroundColor = color;
    if (headshot) hitmarker.dataset.headshot = '1';
    else delete hitmarker.dataset.headshot;

    hitmarker.hidden = false;
    if (hitmarkerTimer !== null) clearTimeout(hitmarkerTimer);
    hitmarkerTimer = setTimeout(() => {
      hitmarkerTimer = null;
      hitmarker.hidden = true;
    }, CONFIG.HUD.hitmarkerTime * 1000);
  }

  function removeKill(entry) {
    const timer = killFeedTimers.get(entry);
    if (timer !== undefined) {
      clearTimeout(timer);
      killFeedTimers.delete(entry);
    }
    entry.remove();
  }

  // One entry per kill, prepended so the newest sits on top. The feed holds
  // CONFIG.HUD.killFeedSize entries and each one fades out on its own after
  // CONFIG.HUD.killFeedLife, so a quiet stretch empties it from the bottom up.
  function showKill({ killer = 'YOU', victim, weapon, headshot = false } = {}) {
    const entry = make('div', 'hud-killfeed-entry');
    const killerEl = make('span', 'hud-killfeed-killer', { opacity: '0.85' });
    killerEl.textContent = killer;
    const weaponEl = make('span', 'hud-killfeed-weapon', { margin: '0 6px', opacity: '0.7' });
    weaponEl.textContent = weapon ?? '';
    const victimEl = make('span', 'hud-killfeed-victim', { fontWeight: '700' });
    victimEl.textContent = victim ?? '';
    entry.append(killerEl, weaponEl, victimEl);

    if (headshot) {
      entry.dataset.headshot = '1';
      const icon = make('span', 'hud-killfeed-headshot', { margin: '0 6px', color: HEADSHOT_COLOR });
      icon.textContent = HEADSHOT_ICON;
      entry.insertBefore(icon, victimEl);
    }

    killFeed.prepend(entry);
    killFeedTimers.set(
      entry,
      setTimeout(() => removeKill(entry), CONFIG.HUD.killFeedLife * 1000),
    );
    while (killFeed.children.length > CONFIG.HUD.killFeedSize) removeKill(killFeed.lastElementChild);
  }

  function clearKillFeed() {
    for (const entry of [...killFeedTimers.keys()]) removeKill(entry);
  }

  function hideDamageIndicator() {
    if (damageTimer !== null) {
      clearTimeout(damageTimer);
      damageTimer = null;
    }
    damageIndicator.hidden = true;
  }

  // `angle` is damageIndicatorAngle() output: 0 ahead, +PI/2 to the right. CSS rotates
  // clockwise, which is the same direction, so the arc drawn straight up points where the
  // shot came from once the container carries that rotation. A wound from a second shooter
  // moves the arc rather than adding one — one arrow is enough to read a firefight from.
  function showDamageIndicator({ angle = 0 } = {}) {
    const deg = (angle * 180) / Math.PI;
    damageIndicator.dataset.angleDeg = deg.toFixed(2);
    damageIndicator.style.transform = `rotate(${deg}deg)`;
    damageIndicator.hidden = false;

    if (damageTimer !== null) clearTimeout(damageTimer);
    damageTimer = setTimeout(() => {
      damageTimer = null;
      damageIndicator.hidden = true;
    }, CONFIG.HUD.damageIndicatorTime * 1000);
  }

  function update(view = {}) {
    const whole = (v) => Math.max(0, Math.round(v));
    set(health, when(view.health, whole));
    if (view.health !== undefined) {
      const hp = Math.max(0, view.health);
      const dead = hp <= 0;
      deathOverlay.hidden = !dead;
      // The vignette fades in across the last CONFIG.HUD.lowHealthAt points and stands
      // down for the death overlay, so dying is not also a full-red screen.
      const strength = dead ? 0 : clamp01((CONFIG.HUD.lowHealthAt - hp) / CONFIG.HUD.lowHealthAt) * VIGNETTE_MAX;
      vignette.hidden = strength <= 0;
      vignette.style.opacity = strength.toFixed(3);
    }
    set(mag, when(view.mag, whole));
    set(reserve, when(view.reserve, whole));
    set(weapon, view.weaponName);
    if (view.score) {
      set(scorePlayer, view.score.player);
      set(scoreBots, view.score.bots);
    }
    set(timer, when(view.roundTime, formatTime));
    set(fpsEl, when(view.fps, whole));
    if (view.crosshairRadius !== undefined) setCrosshairGap(view.crosshairRadius);
    if (view.scoped !== undefined) {
      scope.hidden = !view.scoped;
      crosshair.hidden = !!view.scoped;
    }
    if (view.reloading !== undefined) reload.hidden = !view.reloading;
    if (view.reloadProgress !== undefined) reloadFill.style.width = `${Math.round(clamp01(view.reloadProgress) * 100)}%`;

    // The ended round phase IS the intermission, so the result and its countdown belong to
    // one element; 'playing' (or no round in the view at all) leaves the banner down.
    if (view.roundPhase === 'won' || view.roundPhase === 'lost') {
      set(bannerText, view.roundPhase === 'won' ? 'ROUND WON' : 'ROUND LOST');
      set(bannerCountdown, when(view.roundCountdown, (v) => Math.max(0, Math.ceil(v))));
      banner.hidden = false;
    } else if (view.roundPhase === 'playing') {
      banner.hidden = true;
    }
  }

  if (root) root.appendChild(layer);

  return {
    el: layer,
    update,
    showHitmarker,
    hideHitmarker,
    showKill,
    clearKillFeed,
    showDamageIndicator,
    hideDamageIndicator,
    els: {
      health,
      mag,
      reserve,
      weapon,
      ammo,
      score,
      scorePlayer,
      scoreBots,
      timer,
      fps: fpsEl,
      crosshair,
      crosshairLines,
      scope,
      hitmarker,
      reload,
      reloadFill,
      killFeed,
      damageIndicator,
      banner,
      bannerText,
      bannerCountdown,
      vignette,
      deathOverlay,
    },
  };
}

export default createHud;
