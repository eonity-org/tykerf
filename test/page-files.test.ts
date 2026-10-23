// Screenshots and checks see the page with its files: its pictures (assets/<file>) and, in a site, the site's own
// files (/assets/<file>, such as the shared theme's fonts), served as the editor serves them. A page opened on
// about:blank resolves none of them, so pictures showed broken and the fonts fell back to Georgia.

import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPage, pageFiles } from '../src/screenshot.js';
import { siteOf } from '../src/site.js';
import { Workspace } from '../src/workspace.js';

const svg = (colour: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${colour}"/></svg>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** A page of a site, whose title box shows a picture of the page and one of the site. */
function sitePage() {
  const site = mkdtempSync(join(tmpdir(), 'tykerf-files-'));
  const dir = join(site, 'rome');
  // without its box types, which keep pictures out of the title box
  cpSync('examples/widgets', dir, { recursive: true, filter: (f) => !/[\\/]types([\\/]|$)/.test(f) });
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'red.svg'), svg('red'));
  mkdirSync(join(site, 'assets'));
  writeFileSync(join(site, 'assets', 'mark.svg'), svg('blue'));
  const ws = new Workspace(dir, { site: siteOf(dir) });
  ws.setContent('title', '<img id="own" src="assets/red.svg" alt=""><img id="shared" src="/assets/mark.svg" alt=""><img id="none" src="assets/missing.svg" alt="">');
  return ws;
}

/** The natural width of each picture once the page has loaded: 0 when it didn't load. */
async function widths(html: string, files?: ReturnType<typeof pageFiles>) {
  const page = await browser.newPage();
  try {
    await openPage(page, html, files);
    return await page.evaluate(() => Object.fromEntries([...document.images].map((i) => [i.id, i.naturalWidth])));
  } finally {
    await page.close();
  }
}

describe('a page in screenshots and checks', () => {
  it('loads its own pictures and the site\'s files, as in the editor', async () => {
    const ws = sitePage();
    expect(await widths(ws.page(), pageFiles(ws))).toEqual({ own: 40, shared: 40, none: 0 });
  });

  it('loaded none of them on about:blank, as before', async () => {
    const ws = sitePage();
    expect(await widths(ws.page())).toEqual({ own: 0, shared: 0, none: 0 });
  });

  it('serves only the page\'s and the site\'s assets', () => {
    const ws = sitePage();
    const files = pageFiles(ws);
    expect(files.base).toBe('/page/');
    expect(Buffer.from(files.read('/page/assets/red.svg')!).toString()).toContain('red');
    expect(Buffer.from(files.read('/assets/mark.svg')!).toString()).toContain('blue');
    expect(files.read('/page/layout.slice')).toBeNull();
    expect(() => files.read('/page/assets/../layout.slice')).toThrow(); // the store refuses it, and openPage answers 404

    // a page on its own sits at the root, its assets at /assets/
    const alone = mkdtempSync(join(tmpdir(), 'tykerf-files-alone-'));
    cpSync('examples/widgets', alone, { recursive: true });
    mkdirSync(join(alone, 'assets'));
    writeFileSync(join(alone, 'assets', 'red.svg'), svg('red'));
    const own = pageFiles(new Workspace(alone));
    expect(own.base).toBe('/');
    expect(own.read('/assets/red.svg')).not.toBeNull();
  });
});
