// Generates all app icons (web favicon, Android launcher/splash, Electron ICO)
// from the design constants below — the single source of truth for the logo.
// Rendering: Playwright (already a transitive dependency, no new packages).
// Design decisions: docs/pipeline/app-logo.md (Sektion 0, bindend).
//
// Usage: node scripts/generate-icons.mjs   (idempotent, overwrites in place)

import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- design ---

const GREEN = '#2b8a3e'; // App-Akzentfarbe (src/App.css --accent)
const CHECK = 'M16.5 33.5 L27.5 44.5 L47.5 21.5';
const STROKE = 9.5;
const TILE_RX = 14;

const check = (color = '#fff') =>
  `<path d="${CHECK}" fill="none" stroke="${color}" stroke-width="${STROKE}" ` +
  `stroke-linecap="round" stroke-linejoin="round"/>`;

// Haken um das Zentrum (32,32) skaliert — z. B. für die Adaptive-Icon-Safe-Zone.
const scaledCheck = (scale) =>
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${check()}</g>`;

const svg = (w, h, body, viewBox = '0 0 64 64') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${body}</svg>`;

// Grüne Kachel mit weißem Haken (Favicon-/ICO-Look).
const tileBody = `<rect width="64" height="64" rx="${TILE_RX}" fill="${GREEN}"/>${check()}`;

// Legacy-Launcher: Kachel mit 4 % transparentem Rand (Pre-Android-8-Geräte).
const legacyBody = `<g transform="translate(32 32) scale(0.92) translate(-32 -32)">${tileBody}</g>`;

// Runder Legacy-Launcher: Kreis Ø 98 %, Haken auf 0.8 skaliert.
const roundBody = `<circle cx="32" cy="32" r="31.36" fill="${GREEN}"/>${scaledCheck(0.8)}`;

// Adaptive-Icon-Foreground: nur der Haken, 0.72 skaliert (Safe-Zone 66/108;
// max. zulässiger Faktor gegen die Haken-BBox ist ≈ 0.735).
const foregroundBody = scaledCheck(0.72);

// apple-touch-icon: vollflächig (iOS rundet selbst, Transparenz unerwünscht).
const appleBody = `<rect width="64" height="64" fill="${GREEN}"/>${scaledCheck(0.72)}`;

// Splash: Vollfläche Grün, Haken zentriert in einer Box von 35 % der kurzen Seite.
const splashSvg = (w, h) => {
  const s = Math.round(0.35 * Math.min(w, h));
  const x = Math.round((w - s) / 2);
  const y = Math.round((h - s) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${GREEN}"/>` +
    `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 64 64">${check()}</svg></svg>`;
};

// --------------------------------------------------------------- targets ---

const RES = 'apps/mobile/android/app/src/main/res';
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
const SPLASH = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// ------------------------------------------------------------- rendering ---

async function launch() {
  for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opts); } catch { /* nächste Option */ }
  }
  throw new Error('Kein Chromium/Edge/Chrome für Playwright startbar.');
}

async function renderPng(page, svgMarkup, w, h, { transparent = true } = {}) {
  await page.setViewportSize({ width: Math.max(w, 16), height: Math.max(h, 16) });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}svg{display:block}</style>${svgMarkup}`
  );
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
}

function write(relPath, data) {
  const abs = resolve(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  console.log('✓', relPath);
}

// ICO-Container: ICONDIR + ICONDIRENTRYs + PNG-Blobs (PNG-in-ICO, Vista+).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirs = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(size >= 256 ? 0 : size, 0);
    d.writeUInt8(size >= 256 ? 0 : size, 1);
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    dirs.push(d);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

// ------------------------------------------------------------------ main ---

const browser = await launch();
const page = await browser.newPage();

// Web
write('public/favicon.svg', svg('64', '64', tileBody) + '\n');
write('public/favicon.png', await renderPng(page, svg(32, 32, tileBody), 32, 32));
write('public/apple-touch-icon.png',
  await renderPng(page, svg(180, 180, appleBody), 180, 180, { transparent: false }));

// Electron (Pfad wird von electron/package.json build.win.icon erwartet)
const icoEntries = [];
for (const size of ICO_SIZES) {
  icoEntries.push({ size, png: await renderPng(page, svg(size, size, tileBody), size, size) });
}
write('public/icon.ico', buildIco(icoEntries));
// Linux (deb/pacman/AppImage): electron-builder build.linux.icon erwartet ein
// grosses PNG; daraus erzeugt es die hicolor-Groessen selbst.
write('public/icon-512.png', await renderPng(page, svg(512, 512, tileBody), 512, 512));

// Android: Launcher-Icons je Dichte
for (const [density, launcher, fg] of DENSITIES) {
  write(`${RES}/mipmap-${density}/ic_launcher.png`,
    await renderPng(page, svg(launcher, launcher, legacyBody), launcher, launcher));
  write(`${RES}/mipmap-${density}/ic_launcher_round.png`,
    await renderPng(page, svg(launcher, launcher, roundBody), launcher, launcher));
  write(`${RES}/mipmap-${density}/ic_launcher_foreground.png`,
    await renderPng(page, svg(fg, fg, foregroundBody), fg, fg));
}

// Android: Splashscreens
for (const [dir, w, h] of SPLASH) {
  write(`${RES}/${dir}/splash.png`, await renderPng(page, splashSvg(w, h), w, h, { transparent: false }));
}

await browser.close();
console.log('Fertig — alle Icon-Assets generiert.');
