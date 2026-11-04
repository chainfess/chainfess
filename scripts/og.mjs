#!/usr/bin/env node
// Renders og.png (1200x630), favicons and the faint rules background. Dev dependency only: run `npm i` in scripts/ first.
// Writes to web/public (committed, so the build needs no sharp) and to web/dist when it exists. At golive it picks up the CA from web/token.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'web', 'public'), DIST = join(ROOT, 'web', 'dist');
let sharp, opentype;
try {
  sharp = (await import('sharp')).default;
  opentype = (await import('opentype.js')).default;
} catch {
  console.error('og.mjs: dev dependencies missing (cd scripts && npm i). Keeping the committed web/public/og.png.');
  process.exit(0);
}
const font = opentype.parse(readFileSync(join(ROOT, 'scripts', 'fonts', 'azeret-mono-600.ttf')).buffer);
const text = (s, x, y, size, fill, track = 0) => {
  let d = '', cx = x;
  for (const ch of s) {
    const g = font.charToGlyph(ch);
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth / font.unitsPerEm) * size + track;
  }
  return `<path d="${d}" fill="${fill}"/>`;
};

const token = JSON.parse(readFileSync(join(ROOT, 'web', 'token.json'), 'utf8'));
const keyPath = join(ROOT, 'marketing', 'src', 'key-visual-1200x630.png');
let base;
if (existsSync(keyPath)) {
  base = sharp(keyPath).resize(1200, 630, { fit: 'cover' });
} else {
  // Fallback: the strip's own language, no asset.
  const sp = (x, y) => `M${x - 16} ${y}L${x - 7} ${y + 6}L${x} ${y - 90}L${x + 6} ${y + 18}L${x + 11} ${y - 9}L${x + 17} ${y}`;
  const line = (y, xs) => `M0 ${y}${xs.map((x) => sp(x, y).replace('M', 'L')).join('')}L1200 ${y}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#EEF1E8"/>
    <path d="${line(400, [240, 900])}" fill="none" stroke="#1C3F8F" stroke-width="3"/><path d="${line(560, [240, 570, 900])}" fill="none" stroke="#141616" stroke-width="3"/>
    <ellipse cx="572" cy="515" rx="64" ry="84" fill="none" stroke="#D2331C" stroke-width="8"/></svg>`;
  base = sharp(Buffer.from(svg));
}
const live = token.launched && /^0x[0-9a-fA-F]{40}$/.test(token.ca) && !/^0x0{40}$/.test(token.ca);
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  ${text('Your agent says X.', 44, 86, 46, '#1C3F8F', -2.4)}
  ${text('The chain says Y.', 44, 140, 46, '#141616', -2.4)}
  ${text('chainfess.pro', 868, 590, 34, '#141616', -1.5)}
  ${live ? text(`CA ${token.ca}`, 500, 612, 18, '#141616', -0.6) : ''}
</svg>`;
const og = await base.composite([{ input: Buffer.from(overlay) }]).png({ compressionLevel: 9, palette: true, quality: 92, colours: 200 }).toBuffer();
writeFileSync(join(PUB, 'og.png'), og);
if (existsSync(DIST)) writeFileSync(join(DIST, 'og.png'), og);

const fav = readFileSync(join(PUB, 'favicon.svg'));
await sharp(fav, { density: 300 }).resize(32, 32).png().toFile(join(PUB, 'favicon-32.png'));
await sharp(fav, { density: 600 }).resize(192, 192).png().toFile(join(PUB, 'icon-192.png'));

if (existsSync(keyPath)) {
  await sharp(keyPath).resize(1100).webp({ quality: 42 }).toFile(join(PUB, 'rules-bg.webp'));
}
const tile = join(ROOT, 'marketing', 'src', 'paper-tile.webp');
if (existsSync(tile)) writeFileSync(join(PUB, 'paper-tile.webp'), readFileSync(tile));
console.log(`og.mjs: og.png ${(og.length / 1024).toFixed(0)} KB${live ? ' with CA' : ''}`);
