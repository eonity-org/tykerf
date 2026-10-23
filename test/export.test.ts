// Exporting a page or a site as plain files: relative addresses, assets, the report, the zip.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { exportFiles, exportToFolder, exportZip, relativize, remoteLoads } from '../src/export.js';
import { newSitePage, setHome, setTitle } from '../src/site.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 30_000 });

const tmp = () => mkdtempSync(join(tmpdir(), 'tykerf-export-'));
const PNG = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'));

/** A site of two pages linking to each other, an image of the page and one from another server. */
function site() {
  const dir = tmp();
  const home = newSitePage(dir, 'home');
  const about = newSitePage(dir, 'about');
  const box = (ws: Workspace) => ws.boxIds()[0] ?? ws.load().root.id;
  home.setContent(box(home), '<p><a id="to-about" href="/about/#team">About</a> <a href="/gone/">gone</a> <img src="assets/dot.png" alt=""> <img src="https://cdn.example.com/x.jpg" alt=""></p>', 'user');
  about.setContent(box(about), '<p id="team"><a id="to-home" href="/home">Home</a><span style="background:url(\'/home/assets/dot.png\')"></span></p>', 'user');
  home.store.write('assets/dot.png', PNG);
  return dir;
}

/** Read a zip back (stored or deflated entries), enough to check what exportZip wrote. */
function unzip(b: Uint8Array): Record<string, Buffer> {
  const buf = Buffer.from(b);
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + n);
    const data = buf.subarray(i + 30 + n + extra, i + 30 + n + extra + size);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    i += 30 + n + extra + size;
  }
  return out;
}

describe('export', () => {
  it('makes addresses written from the site root relative to each page', () => {
    const pages = ['home', 'about'];
    expect(relativize('<a href="/about/">', 1, pages)).toBe('<a href="../about/">');
    expect(relativize('<a href="/about">', 1, pages)).toBe('<a href="../about/">');
    expect(relativize('<a href="/about#x">', 1, pages, { files: true })).toBe('<a href="../about/index.html#x">');
    expect(relativize('<a href="/about/team">', 1, pages)).toBe('<a href="../about/team">');
    expect(relativize('<img src="/assets/a.png" srcset="/assets/a.png 1x, /assets/b.png 2x">', 1, pages)).toBe('<img src="../assets/a.png" srcset="../assets/a.png 1x, ../assets/b.png 2x">');
    expect(relativize('<div style="background:url(/assets/a.png)">', 0, [])).toBe('<div style="background:url(./assets/a.png)">');
    for (const same of ['<a href="https://x.com/about/">', '<a href="#top">', '<img src="//cdn.x/a.png">', '<img src="assets/a.png">', '<a href="mailto:a@b.c">'])
      expect(relativize(same, 1, pages)).toBe(same);
    const broken: string[] = [];
    relativize('<a href="/nope/">', 1, pages, {}, (h) => broken.push(h));
    expect(broken).toEqual(['/nope/']);
  });

  it('finds what a page still loads from other servers', () => {
    expect(remoteLoads('<a href="https://x.com">x</a><img src="https://a.com/1.png"><link rel="stylesheet" href="//fonts.b.com/css"><img srcset="https://c.com/2.png 2x, assets/3.png 1x"><i style="background:url(https://d.com/4.png)"></i><img src="assets/5.png">'))
      .toEqual(['https://a.com/1.png', '//fonts.b.com/css', 'https://c.com/2.png', 'https://d.com/4.png']);
  });

  it('writes each page of a site in its own folder, with its assets and a front door, and reports what to fix', () => {
    const dir = site();
    const out = tmp();
    const report = exportToFolder(dir, out);
    expect(report.pages).toEqual(['about', 'home']);
    for (const f of ['index.html', 'home/index.html', 'about/index.html', 'home/assets/dot.png']) expect(existsSync(join(out, f)), f).toBe(true);
    const home = readFileSync(join(out, 'home/index.html'), 'utf8');
    expect(home).toContain('href="../about/#team"');
    expect(home).not.toContain('_tykerf');
    expect(readFileSync(join(out, 'about/index.html'), 'utf8')).toContain("url('../home/assets/dot.png')");
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('url=./about/');
    expect(report.broken).toEqual([{ page: 'home', href: '/gone/' }]);
    expect(report.remote.map((r) => r.url)).toEqual(['https://cdn.example.com/x.jpg']);
    expect(existsSync(join(out, 'home/.history.jsonl'))).toBe(false);
    expect(exportFiles(dir).files.some((f) => /\.tykerf|history|layout\.slice|boxes\//.test(f.path))).toBe(false);
  });

  it('opens the home page at the front door, lists the pages in pages/, and writes a sitemap with a public address', () => {
    const dir = site();
    setHome(dir, 'about');
    setTitle(dir, 'about', 'About us');
    const { files } = exportFiles(dir, { publicUrl: 'https://example.org/' });
    const read = (p: string) => new TextDecoder().decode(files.find((f) => f.path === p)!.bytes);
    expect(read('index.html')).toContain('url=./about/');
    const list = read('pages/index.html');
    expect(list).toMatch(/<li><a href="\.\.\/about\/"><span class="title">About us<\/span>.*<\/li>\s*<li><a href="\.\.\/home\/"><span class="title">home<\/span>/); // the home page first
    expect(read('about/index.html')).toContain('<title>About us</title>');
    expect(read('sitemap.xml')).toContain('<loc>https://example.org/</loc>');
    expect(read('sitemap.xml')).toContain('<loc>https://example.org/home/</loc>');
    expect(exportFiles(dir).files.some((f) => f.path === 'sitemap.xml')).toBe(false);
  });

  it('exports a lone page at the root', () => {
    const dir = tmp();
    const ws = newSitePage(dir, 'x');
    ws.store.write('assets/dot.png', PNG);
    ws.store.write('assets/unused.png', PNG); // an earlier crop, say: not exported
    ws.setContent(ws.boxIds()[0], '<img src="assets/dot.png">', 'user');
    const { files, report } = exportFiles(join(dir, 'x'));
    expect(files.map((f) => f.path).filter((f) => !f.endsWith('.woff2')).sort()).toEqual(['assets/dot.png', 'index.html']);
    expect(files.some((f) => f.path === 'assets/inter-latin-wght-normal.woff2')).toBe(true); // the theme's fonts go along
    expect(report.pages).toEqual(['index']);
  });

  it('packs the same files in a zip that reads back', () => {
    const dir = site();
    const { bytes } = exportZip(dir);
    const files = unzip(bytes);
    expect(Object.keys(files).filter((f) => !f.endsWith('.woff2')).sort()).toEqual(['404.html', 'about/index.html', 'favicon.svg', 'home/assets/dot.png', 'home/index.html', 'index.html', 'pages/index.html']);
    expect(files['home/assets/dot.png'].equals(Buffer.from(PNG))).toBe(true);
    expect(files['home/index.html'].toString()).toContain('href="../about/#team"');
  });

  it('has a 404.html for web hosts, whose links work at any depth; not when opened from disk', async () => {
    const dir = site();
    const at = (publicUrl?: string) => unzip(exportZip(dir, { publicUrl }).bytes)['404.html'].toString();
    const root = at();
    expect(root).toContain('<base href="/">');
    expect(root).toContain('<link rel="icon" href="./favicon.svg" type="image/svg+xml">');
    const zipped = unzip(exportZip(dir).bytes);
    expect(zipped['favicon.svg'].toString()).toMatch(/^<svg /);
    expect(zipped['home/index.html'].toString()).toContain('<link rel="icon" href="../favicon.svg" type="image/svg+xml">');
    expect(root).toContain('<h1>This page isn\'t here</h1>');
    expect(root).toMatch(/<a href="\.\/about\/">/);
    // it says where TYKERF is, with its mark
    expect(root).toMatch(/<footer><svg viewBox="0 0 64 64"[\s\S]*<a href="https:\/\/github\.com\/eonity-org\/tykerf" rel="nofollow">github\.com\/eonity-org\/tykerf<\/a><\/footer>/);
    // the site's own pages carry "Made with TYKERF" only when asked (Publish asks, unless turned off)
    const plain = unzip(exportZip(dir).bytes);
    expect(plain['home/index.html'].toString()).not.toContain('tykerf-credit');
    expect(plain['pages/index.html'].toString()).not.toContain('eonity-org');
    const credited = unzip(exportZip(dir, { credit: true }).bytes);
    expect(credited['home/index.html'].toString()).toMatch(/<footer class="tykerf-credit"[^>]*><a href="https:\/\/github\.com\/eonity-org\/tykerf"[\s\S]*Made with TYKERF<\/span><\/a><\/footer>\s*<\/body>/);
    expect(credited['pages/index.html'].toString()).toContain('github.com/eonity-org/tykerf');
    expect(at('https://me.github.io/tk1')).toContain('<base href="/tk1/">');
    expect(Object.keys(unzip(exportZip(dir, { files: true }).bytes))).not.toContain('404.html');
    // served at a deep unknown address (as Cloudflare Pages does), its links lead to the pages, not deeper
    const out = tmp();
    exportToFolder(dir, out);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route('http://site.test/**', (r) => {
        const path = new URL(r.request().url()).pathname;
        const file = join(out, path.endsWith('/') ? `${path}index.html` : path);
        return existsSync(file) ? r.fulfill({ path: file }) : r.fulfill({ status: 404, path: join(out, '404.html') });
      });
      await page.goto('http://site.test/munich2/deeper/');
      expect(await page.locator('a', { hasText: 'about' }).first().evaluate((a: HTMLAnchorElement) => a.href)).toBe('http://site.test/about/');
    } finally {
      await browser.close();
    }
  });

  it('works opened from disk: a link between pages leads to the other page', async () => {
    const out = tmp();
    exportToFolder(site(), out, { files: true });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(join(out, 'index.html')).href);
      await page.waitForURL(/about\/index\.html$/);
      await page.click('#to-home');
      await page.waitForURL(/home\/index\.html$/);
      expect(await page.locator('img[src="assets/dot.png"]').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
      await page.click('#to-about');
      await page.waitForURL(/about\/index\.html#team$/);
    } finally {
      await browser.close();
    }
  });
});
