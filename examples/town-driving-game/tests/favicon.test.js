import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

const iconTag = html.match(/<link\b[^>]*rel="icon"[^>]*>/)?.[0];

describe('favicon', () => {
  it('declares an icon link so the browser stops requesting /favicon.ico', () => {
    expect(iconTag).toBeDefined();
  });

  it('inlines it as a data: URI — no extra request, no 404', () => {
    const href = iconTag.match(/href="([^"]+)"/)[1];
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(href).not.toContain('favicon.ico');
  });

  it('is a self-contained svg using the HUD amber on the page shell color', () => {
    const svg = decodeURIComponent(iconTag);
    expect(svg).toContain("<svg xmlns='http://www.w3.org/2000/svg'");
    expect(svg).toContain('viewBox');
    expect(svg).toContain('#ffd257');
    expect(svg).toContain('#0b1220');
  });
});
