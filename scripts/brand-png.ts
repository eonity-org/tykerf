// Render the brand SVGs (src/editor/public/brand) to PNG at the usual sizes, transparent, into brand/png/.
// The wordmark uses the bundled IBM Plex Sans Light, so the PNGs match the SVG logo exactly.
//
//   npx tsx scripts/brand-png.ts

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BRAND = 'src/editor/public/brand';
const OUT = join(BRAND, 'png');
mkdirSync(OUT, { recursive: true });
const font = readFileSync('src/editor/public/fonts/IBMPlexSans-Light-Latin1.woff2').toString('base64');
const face = `@font-face{font-family:'IBM Plex Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:300}`;

// [svg file, output name, heights]: small sizes use the drawing with wider cuts
const jobs: [string, string, number[]][] = [
  ['tykerf-mark-small.svg', 'tykerf-mark', [16, 24, 32]],
  ['tykerf-mark.svg', 'tykerf-mark', [48, 64, 128, 256, 512, 1024]],
  ['tykerf-mark-white.svg', 'tykerf-mark-white', [32, 64, 128, 256, 512]],
  ['tykerf-mark-mono.svg', 'tykerf-mark-mono', [32, 64, 128, 256, 512]],
  ['tykerf-app-icon.svg', 'tykerf-app-icon', [32, 180, 192, 512, 1024]],
  ['tykerf-logo.svg', 'tykerf-logo', [32, 64, 128, 256, 512]],
];

const b = await chromium.launch();
const page = await b.newPage();
for (const [file, name, heights] of jobs) {
  const svg = readFileSync(join(BRAND, file), 'utf8');
  const [, , vw, vh] = (/viewBox="([^"]+)"/.exec(svg)![1]).split(/\s+/).map(Number);
  for (const mh of heights) {
    // logo heights are the mark's height (64 units); the drawing is a little taller, for the round bottom of the "e"
    const h = name === 'tykerf-logo' ? Math.round((mh * vh) / 64) : mh;
    const w = Math.round((h * vw) / vh);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>${face}html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(50);
    const suffix = name === 'tykerf-logo' ? `${w}x${h}` : `${h}`;
    await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), omitBackground: true });
  }
}
await b.close();
