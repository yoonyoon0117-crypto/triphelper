#!/usr/bin/env node
/**
 * 홈 화면 아이콘 생성 — public/icon-source.svg 를 Chromium 으로 렌더링해 PNG 로 저장합니다.
 *   npm run icons
 * 산출물: public/icons/{icon-512,icon-192,icon-maskable-512,apple-touch-icon}.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');

const BROWSERS = path.join(WORKSPACE, '.tools', 'pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
}
const LIBS = path.join(WORKSPACE, '.tools', 'libs');
if (fs.existsSync(LIBS)) process.env.LD_LIBRARY_PATH = [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

const { chromium } = require('playwright');

const OUT_DIR = path.join(ROOT, 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });
const source = fs.readFileSync(path.join(ROOT, 'public', 'icon-source.svg'), 'utf8');

function variant(scale) {
  if (scale === 1) return source;
  return source.replace(
    /<!-- MOTIF:START -->([\s\S]*?)<!-- MOTIF:END -->/,
    (_, inner) => `<g transform="translate(256,256) scale(${scale}) translate(-256,-256)">${inner}</g>`
  );
}

const targets = [
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  const svg = variant(t.scale);
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: path.join(OUT_DIR, t.file), omitBackground: false });
  await page.close();
  console.log(`✓ ${t.file} (${t.size}px)`);
}
await browser.close();
console.log(`아이콘 저장 위치: ${OUT_DIR}`);
