// Render the icon SVGs (src/editor/public/brand) to PNG at the usual sizes, transparent, into brand/png/.
// The logo isn't drawn here: it is a picture exported from its master (BRAND.md), png/tykerf-logo-*.png.
//
//   npx tsx scripts/brand-png.ts

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BRAND = 'src/editor/public/brand';
const OUT = join(BRAND, 'png');
mkdirSync(OUT, { recursive: true });

// [svg file, output name, heights]: the icon is the same drawing at every size, down to 16 px (BRAND.md)
const jobs: [string, string, number[]][] = [
  ['tykerf-mark.svg', 'tykerf-mark', [16, 24, 32, 48, 64, 128, 256, 512, 1024]],
  ['tykerf-mark-white.svg', 'tykerf-mark-white', [32, 64, 128, 256, 512]],
  ['tykerf-mark-mono.svg', 'tykerf-mark-mono', [32, 64, 128, 256, 512]],
  ['tykerf-app-icon.svg', 'tykerf-app-icon', [32, 180, 192, 512, 1024]],
];

const b = await chromium.launch();
const page = await b.newPage();
for (const [file, name, heights] of jobs) {
  const svg = readFileSync(join(BRAND, file), 'utf8');
  const [, , vw, vh] = (/viewBox="([^"]+)"/.exec(svg)![1]).split(/\s+/).map(Number);
  for (const h of heights) {
    const w = Math.round((h * vw) / vh);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
    await page.waitForTimeout(50);
    await page.screenshot({ path: join(OUT, `${name}-${h}.png`), omitBackground: true });
  }
}
await b.close();
