// Bringing a copied site's images and fonts into the page (import-files.ts), with a stand-in for the network.

import { describe, expect, it } from 'vitest';
import { type Fetcher, assetPath, copyFiles, fontType, plainSVG } from '../src/import-files.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(20)]);
const enc = (s: string) => new TextEncoder().encode(s);

const web = (files: Record<string, Uint8Array | string>): Fetcher & { asked: string[] } => {
  const asked: string[] = [];
  const f = async (url: string) => {
    asked.push(url);
    const b = files[url];
    if (b === undefined) throw new Error('HTTP 404');
    return typeof b === 'string' ? enc(b) : new Uint8Array(b);
  };
  return Object.assign(f, { asked });
};

describe('what a copy brings along', () => {
  it('recognises images and fonts by their bytes, and SVGs only without scripts', () => {
    expect(fontType(WOFF2)).toBe('woff2');
    expect(fontType(enc('wOFFxxxx'))).toBe('woff');
    expect(fontType(enc('OTTOxxxx'))).toBe('otf');
    expect(fontType(new Uint8Array([0, 1, 0, 0, 9]))).toBe('ttf');
    const eot = new Uint8Array(40);
    eot.set([0x4c, 0x50], 34);
    expect(fontType(eot)).toBe('eot');
    expect(fontType(enc('<html>'))).toBeNull();
    expect(assetPath(PNG)).toMatch(/^assets\/img-[0-9a-f]{12}\.png$/);
    expect(assetPath(WOFF2)).toMatch(/^assets\/font-[0-9a-f]{12}\.woff2$/);
    expect(plainSVG(enc('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'))).toBe(true);
    expect(plainSVG(enc('<svg><script>alert(1)</script></svg>'))).toBe(false);
    expect(plainSVG(enc('<svg onload="alert(1)"></svg>'))).toBe(false);
    expect(plainSVG(enc('<svg><foreignObject><iframe/></foreignObject></svg>'))).toBe(false);
    expect(assetPath(enc('<html><body>not an image</body></html>'))).toBeNull();
  });

  it('downloads images and fonts once and points the code at them; the rest stays linked', async () => {
    const f = web({ 'https://a.test/p.png': PNG, 'https://a.test/f.woff2': WOFF2, 'https://a.test/page.html': '<html>' });
    const r = await copyFiles([
      '<img class="x1" src="https://a.test/p.png"><img src="https://a.test/gone.png"><a href="https://a.test/p.png">link</a>',
      '.x2{background-image:url("https://a.test/p.png")}',
      '@font-face{font-family:A;src:url(https://a.test/f.woff2) format("woff2")}',
      '<iframe src="https://a.test/page.html"></iframe><img src="data:image/png;base64,AAAA">',
    ], f);
    const img = assetPath(PNG)!, font = assetPath(WOFF2, 'A')!;
    expect(font).toMatch(/^assets\/font-a-[0-9a-f]{12}\.woff2$/);
    expect(Object.keys(r.files).sort()).toEqual([font, img].sort());
    expect(r.code[0]).toBe(`<img class="x1" src="${img}"><img src="https://a.test/gone.png"><a href="https://a.test/p.png">link</a>`);
    expect(r.code[1]).toBe(`.x2{background-image:url("${img}")}`);
    expect(r.code[2]).toBe(`@font-face{font-family:A;src:url("${font}") format("woff2")}`);
    expect(r.code[3]).toContain('src="https://a.test/page.html"'); // not an image or a font
    expect(r.kept.sort()).toEqual(['https://a.test/gone.png', 'https://a.test/page.html']);
    expect(f.asked.filter((u) => u === 'https://a.test/p.png')).toHaveLength(1);
  });

  it('turns a linked font stylesheet into a <style> block and brings its fonts along', async () => {
    const css = "@font-face{font-family:Web;src:url(files/web.woff2) format('woff2')}";
    const f = web({ 'https://fonts.test/css?family=Web&display=swap': css, 'https://fonts.test/files/web.woff2': WOFF2 });
    const r = await copyFiles(['<link rel="stylesheet" href="https://fonts.test/css?family=Web&amp;display=swap">'], f);
    expect(r.code[0]).toBe(`<style>\n@font-face{font-family:Web;src:url("${assetPath(WOFF2, 'Web')}") format('woff2')}\n</style>`);
    expect(Object.keys(r.files)).toEqual([expect.stringMatching(/^assets\/font-web-[0-9a-f]{12}\.woff2$/)]);
    expect(r.kept).toEqual([]);
  });

  it('stops at the size limit, and when the copy is stopped', async () => {
    const f = web({ 'https://a.test/p.png': PNG, 'https://a.test/f.woff2': WOFF2 });
    const r = await copyFiles(['<img src="https://a.test/p.png">', 'url(https://a.test/f.woff2)'], f, { limit: PNG.length });
    expect(Object.keys(r.files)).toHaveLength(1);
    expect(r.kept).toHaveLength(1);
    const stop = new AbortController();
    stop.abort();
    await expect(copyFiles(['<img src="https://a.test/p.png">'], f, { signal: stop.signal })).rejects.toThrow('stopped');
  });
});
