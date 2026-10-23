// What a page still has to be finished (src/check.ts): the placeholders layouts and components bring,
// and links without a real target.

import { describe, expect, it } from 'vitest';
import { leftoverKey, leftovers, say } from '../src/check.js';
import { openTools } from '../src/editor/tools-client.js';
import { createPage } from '../src/library.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

const fresh = (pages?: string[]) => new Workspace(new MemoryStore('memory:new'), { site: pages ? { head: () => '', pageNames: () => pages } : null });

describe('what a page has left unfinished', () => {
  it('finds the placeholders a layout brings: sample text, pictures and links that go nowhere', () => {
    const ws = fresh();
    createPage(ws, 'factual');
    const left = leftovers(ws).map(say);
    expect(left).toContain('nav: placeholder text "Page one"');
    expect(left).toContain('nav: the link "Page one" goes nowhere');
    expect(left).toContain('intro: placeholder text "A headline that states the main fact"');
    expect(left).toContain('banner: a placeholder picture (placeholder-wide.svg)');
    // a single word, such as a footer's Privacy, can stay as it is; a component's own controls are not text to replace
    expect(left.some((l) => /placeholder text "(Privacy|Show more)"/.test(l))).toBe(false);
    expect(left).toContain('footer: the link "Privacy" goes nowhere');
    // only the boxes of a block, when one is given
    expect(new Set(leftovers(ws, { within: 'nav' }).map((l) => l.box))).toEqual(new Set(['nav']));
  });

  it('says nothing about finished boxes, and checks links against the page and the site', () => {
    const ws = fresh(['home', 'about']);
    ws.create('nav main H', {
      nav: '<a href="/about/">Read more</a> <a href="#visit">Visit</a> <a href="/blog/">Blog</a> <a href="#gone">Old</a> <a href="https://example.org">Out</a>',
      main: '<h2 id="visit">Visit Rome</h2><p>The Colosseum opens at 9.</p><img src="assets/colosseum.jpg" alt="The Colosseum">',
    });
    ws.store.write('assets/colosseum.jpg', new Uint8Array([1]));
    expect(leftovers(ws).map(say)).toEqual([
      'nav: the link "Blog" points at /blog/, a page the site doesn\'t have (yet)',
      'nav: the link "Old" points at #gone, which is not on the page',
    ]);
    // a block's own element is a target too (its id is sw-<name>), and a link written with the block's name says so
    ws.setContent('nav', '<a href="#main">Main</a>', 'user');
    expect(leftovers(ws).map(say)).toEqual(['nav: the link "Main" points at #main, which is not on the page; the block "main" is #sw-main']);
    ws.setContent('nav', '<a href="#sw-main">Main</a>', 'user');
    expect(leftovers(ws)).toEqual([]);
  });

  it('gives each leftover a stable key, to compare a page before and after a request', () => {
    const ws = fresh();
    createPage(ws, 'blank');
    const before = new Set(leftovers(ws).map(leftoverKey));
    expect(new Set(leftovers(ws).map(leftoverKey))).toEqual(before);
    expect([...before]).toContain('nav|text|Page one');
  });

  it('finds pictures and files the page does not have: a made-up name, a site file that is not there', () => {
    const ws = new Workspace(new MemoryStore('memory:new'), { site: { head: () => '', pageNames: () => ['munich'], files: () => ['font.woff2'] } });
    ws.create('banner main H', {
      banner: '<img src="/assets/marienplatz.webp" alt=""><img src="assets/munich.jpg" alt=""><img src="https://example.org/x.jpg" alt=""><img src="data:image/png;base64,AA" alt="">',
      main: '<div style="background:url(\'assets/tiles.svg\')"></div><img srcset="assets/a.png 1x, assets/b.png 2x" alt=""><style>@font-face{src:url(/assets/font.woff2)}</style>',
    });
    ws.store.write('assets/a.png', new Uint8Array([1]));
    expect(leftovers(ws).map(say)).toEqual([
      'banner: /assets/marienplatz.webp is not one of the page\'s files, so it shows broken',
      'banner: assets/munich.jpg is not one of the page\'s files, so it shows broken',
      'main: assets/b.png is not one of the page\'s files, so it shows broken',
      'main: assets/tiles.svg is not one of the page\'s files, so it shows broken',
    ]);
  });

  it('warns the AI at once about a file it made up, and lets it add a picture it draws or the user attached', async () => {
    const ws = fresh();
    ws.create('banner main H', { banner: '<p>Munich</p>', main: '<p>Hi</p>' });
    ws.store.write('.tykerf/images/' + 'a'.repeat(40) + '.png', new Uint8Array([137, 80, 78, 71]));
    const tools = await openTools(ws, '');
    const made = await tools.call('edit_content', { id: 'banner', old: '<p>Munich</p>', new: '<img src="/assets/marienplatz.jpg" alt="">' });
    expect(made.text).toMatch(/^ok: 1 change in "banner"\nwarning: \/assets\/marienplatz\.jpg is not among the page's files.*Never guess a file name\.$/s);
    const drawn = await tools.call('add_picture', { name: 'plaza', svg: '<svg viewBox="0 0 10 10"><rect width="10" height="5" fill="#c33"/></svg>' });
    expect(drawn.text).toBe('saved assets/plaza.svg: use it as <img src="assets/plaza.svg" alt="…"> (the address has no leading slash)');
    expect(new TextDecoder().decode(ws.store.readBytes('assets/plaza.svg')!)).toContain('xmlns="http://www.w3.org/2000/svg"');
    // the same name again keeps the first file
    expect((await tools.call('add_picture', { name: 'plaza', svg: '<svg></svg>' })).text).toMatch(/assets\/plaza-2\.svg/);
    expect((await tools.call('add_picture', { name: 'photo', attached: 'a'.repeat(40) + '.png' })).text).toMatch(/^saved assets\/photo\.png/);
    expect((await tools.call('set_content', { id: 'banner', html: '<img src="assets/plaza.svg" alt="Plaza de España">' })).text).toBe('ok: content of "banner" set');
    // no scripts, no files from elsewhere, no made-up attachments
    expect((await tools.call('add_picture', { name: 'bad', svg: '<svg onload="alert(1)"></svg>' })).text).toMatch(/may not have scripts/);
    expect((await tools.call('add_picture', { name: 'bad', svg: '<svg><image href="https://x.org/a.png"/></svg>' })).text).toMatch(/links to other files/);
    expect((await tools.call('add_picture', { name: 'bad', attached: 'b'.repeat(40) + '.png' })).text).toMatch(/no attached picture/);
    expect(ws.store.exists('assets/bad.svg')).toBe(false);
    await tools.close();
  });

  it('is a tool for the AI: check_page, on its block', async () => {
    const ws = fresh();
    createPage(ws, 'blank');
    const tools = await openTools(ws, 'nav');
    const out = (await tools.call('check_page', {})).text;
    expect(out).toMatch(/^11 left unfinished:\nnav: placeholder text "Site name"/);
    expect(out).not.toMatch(/^text:/m);
    await tools.close();
  });
});
