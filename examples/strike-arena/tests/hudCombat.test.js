// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { damageIndicatorAngle } from '../src/core/feel.js';
import { createHud } from '../src/ui/hud.js';

const DEG = 180 / Math.PI;
const at = (x, z, y = 0) => ({ x, y, z });

describe('damageIndicatorAngle', () => {
  const origin = at(0, 0);

  it('reads a source straight ahead as zero', () => {
    expect(damageIndicatorAngle(origin, 0, at(0, -12))).toBeCloseTo(0, 9);
  });

  it('puts a source on the right at +90 deg and on the left at -90 deg', () => {
    expect(damageIndicatorAngle(origin, 0, at(12, 0)) * DEG).toBeCloseTo(90, 9);
    expect(damageIndicatorAngle(origin, 0, at(-12, 0)) * DEG).toBeCloseTo(-90, 9);
  });

  it('puts a source behind at 180 deg', () => {
    expect(Math.abs(damageIndicatorAngle(origin, 0, at(0, 12)) * DEG)).toBeCloseTo(180, 9);
  });

  it('turns with the player, so the same world direction moves', () => {
    // yaw PI/2 looks toward -X: -X is now ahead, and +Z sits to the left.
    const yaw = Math.PI / 2;
    expect(damageIndicatorAngle(origin, yaw, at(-12, 0)) * DEG).toBeCloseTo(0, 6);
    expect(damageIndicatorAngle(origin, yaw, at(0, 12)) * DEG).toBeCloseTo(-90, 6);
  });

  it('measures from the player, not from the world origin', () => {
    const player = at(30, -8);
    expect(damageIndicatorAngle(player, 0, at(30, -28)) * DEG).toBeCloseTo(0, 9);
    expect(damageIndicatorAngle(player, 0, at(42, -8)) * DEG).toBeCloseTo(90, 9);
  });

  it('ignores height — a shooter on a ledge keeps his compass bearing', () => {
    expect(damageIndicatorAngle(origin, 0, at(12, 0, 9)) * DEG).toBeCloseTo(90, 9);
  });
});

describe('hud combat readouts', () => {
  let root;
  let hud;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    hud = createHud(root);
  });

  afterEach(() => {
    hud.hideHitmarker();
    hud.hideDamageIndicator();
    hud.clearKillFeed();
    hud.el.remove();
    root.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  describe('kill feed', () => {
    it('shows the newest kill first', () => {
      hud.showKill({ victim: 'bot_1', weapon: 'pistol' });
      hud.showKill({ victim: 'bot_2', weapon: 'rifle' });

      const entries = hud.els.killFeed.children;
      expect(entries).toHaveLength(2);
      expect(entries[0].textContent).toContain('bot_2');
      expect(entries[1].textContent).toContain('bot_1');
    });

    it(`caps the feed at CONFIG.HUD.killFeedSize, dropping the oldest`, () => {
      const total = CONFIG.HUD.killFeedSize + 3;
      for (let i = 1; i <= total; i++) hud.showKill({ victim: `bot_${i}`, weapon: 'rifle' });

      const entries = hud.els.killFeed.children;
      expect(entries).toHaveLength(CONFIG.HUD.killFeedSize);
      expect(entries[0].textContent).toContain(`bot_${total}`);
      // everything below the last killFeedSize kills is gone, so the oldest survivor is #4
      expect(entries[entries.length - 1].textContent).toContain('bot_4');
    });

    it('marks a headshot with an icon and leaves a body kill unmarked', () => {
      hud.showKill({ victim: 'bot_1', weapon: 'rifle' });
      hud.showKill({ victim: 'bot_2', weapon: 'sniper', headshot: true });

      const [headshot, body] = hud.els.killFeed.children;
      expect(headshot.dataset.headshot).toBe('1');
      expect(headshot.querySelector('.hud-killfeed-headshot')).not.toBeNull();
      expect(body.dataset.headshot).toBeUndefined();
      expect(body.querySelector('.hud-killfeed-headshot')).toBeNull();
    });

    it('expires an entry after CONFIG.HUD.killFeedLife', () => {
      hud.showKill({ victim: 'bot_1', weapon: 'rifle' });

      vi.advanceTimersByTime(CONFIG.HUD.killFeedLife * 1000 - 1);
      expect(hud.els.killFeed.children).toHaveLength(1);

      vi.advanceTimersByTime(2);
      expect(hud.els.killFeed.children).toHaveLength(0);
    });
  });

  describe('damage direction indicator', () => {
    it('appears on a wound and clears itself after CONFIG.HUD.damageIndicatorTime', () => {
      expect(hud.els.damageIndicator.hidden).toBe(true);

      hud.showDamageIndicator({ angle: damageIndicatorAngle(at(0, 0), 0, at(0, -5)) });
      expect(hud.els.damageIndicator.hidden).toBe(false);

      vi.advanceTimersByTime(CONFIG.HUD.damageIndicatorTime * 1000 - 1);
      expect(hud.els.damageIndicator.hidden).toBe(false);

      vi.advanceTimersByTime(2);
      expect(hud.els.damageIndicator.hidden).toBe(true);
    });

    it('points at front, right, behind and left', () => {
      const cases = [
        [at(0, -10), 0],
        [at(10, 0), 90],
        [at(0, 10), 180],
        [at(-10, 0), -90],
      ];
      for (const [source, expected] of cases) {
        hud.showDamageIndicator({ angle: damageIndicatorAngle(at(0, 0), 0, source) });
        const shown = Number.parseFloat(hud.els.damageIndicator.dataset.angleDeg);
        expect(shown).toBeCloseTo(expected, 6);
      }
    });

    it('moves to the newest shooter instead of stacking arrows', () => {
      hud.showDamageIndicator({ angle: damageIndicatorAngle(at(0, 0), 0, at(0, -10)) });
      hud.showDamageIndicator({ angle: damageIndicatorAngle(at(0, 0), 0, at(-10, 0)) });

      expect(hud.els.damageIndicator.children).toHaveLength(1);
      expect(Number.parseFloat(hud.els.damageIndicator.dataset.angleDeg)).toBeCloseTo(-90, 6);
    });
  });

  describe('round banner', () => {
    it('names the round result and counts down to the next round', () => {
      expect(hud.els.banner.hidden).toBe(true);

      hud.update({ roundPhase: 'won', roundCountdown: 2.4 });
      expect(hud.els.banner.hidden).toBe(false);
      expect(hud.els.bannerText.textContent).toBe('ROUND WON');
      expect(hud.els.bannerCountdown.textContent).toBe('3');

      hud.update({ roundPhase: 'lost', roundCountdown: 0.2 });
      expect(hud.els.bannerText.textContent).toBe('ROUND LOST');
      expect(hud.els.bannerCountdown.textContent).toBe('1');
    });

    it('stays down while the round is playing', () => {
      hud.update({ roundPhase: 'won', roundCountdown: 1 });
      hud.update({ roundPhase: 'playing', roundCountdown: 0 });
      expect(hud.els.banner.hidden).toBe(true);
    });
  });

  describe('low-health vignette and death overlay', () => {
    const opacity = () => Number.parseFloat(hud.els.vignette.style.opacity || '0');

    it('fades the vignette in as health drops below CONFIG.HUD.lowHealthAt', () => {
      const { lowHealthAt } = CONFIG.HUD;

      hud.update({ health: lowHealthAt + 10 });
      expect(hud.els.vignette.hidden).toBe(true);
      expect(opacity()).toBeCloseTo(0, 6);

      hud.update({ health: lowHealthAt / 2 });
      expect(hud.els.vignette.hidden).toBe(false);
      const half = opacity();
      expect(half).toBeGreaterThan(0);

      hud.update({ health: 1 });
      expect(opacity()).toBeGreaterThan(half);
    });

    it('shows the death overlay at zero health and hands the vignette over to it', () => {
      hud.update({ health: 5 });
      expect(hud.els.deathOverlay.hidden).toBe(true);
      expect(hud.els.vignette.hidden).toBe(false);

      hud.update({ health: 0 });
      expect(hud.els.deathOverlay.hidden).toBe(false);
      expect(hud.els.deathOverlay.textContent).toContain('YOU ARE DEAD');
      expect(hud.els.vignette.hidden).toBe(true);

      hud.update({ health: CONFIG.PLAYER.maxHealth });
      expect(hud.els.deathOverlay.hidden).toBe(true);
      expect(hud.els.vignette.hidden).toBe(true);
    });
  });
});
