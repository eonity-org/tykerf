// The site kit (src/kit.ts): styles, behaviours, shared blocks, box types and tags every page of a
// site shares, with their checks, their undo, export and the tools that change them.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leftovers, say } from '../src/check.js';
import { exportFiles } from '../src/export.js';
import { KIT_LOADER, kitError, kitWarning, kitList, kitRead, kitStyles, kitTags, kitWrite, lastKitChange, markCurrentPage, undoKit } from '../src/kit.js';
import { parseSlice, serializeSlice } from '../src/notation.js';
import { blockUsers, identicalBoxes, linkBlock, newSitePage, pageWorkspace, shareBlock, shareIdentical, unlinkBlock } from '../src/site.js';
import { contentHash, pageFileRefs } from '../src/assets.js';
import * as M from '../src/moves.js';

const site = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-kit-'));
  newSitePage(dir, 'home', 'launch', 'studio');
  newSitePage(dir, 'about', 'company', 'studio');
  return dir;
};

describe('kit files', () => {
  it('are checked, kept with their history, and undone one change at a time', () => {
    const dir = site();
    expect(kitError('styles', 'a', '@import url(x.css);')).toMatch(/no @import/);
    expect(kitError('styles', 'a', 'b { background: url(https://cdn.example.com/x.png) }')).toMatch(/loads from another server/);
    expect(kitError('styles', 'a', 'b { background: url(/assets/x.png) }')).toBeNull();
    expect(kitError('types', 'card', '{"colour": 1}')).toMatch(/unknown key "colour"/);
    expect(kitError('tags', 'tags', '{"dense": {"label": "x"}}')).toMatch(/TYKERF's own tags/);
    expect(() => kitWrite(dir, 'styles', 'Bad Name', 'x{}')).toThrow(/can't be a kit file name/);

    kitWrite(dir, 'styles', 'base', 'h2 { color: red }');
    kitWrite(dir, 'styles', 'base', 'h2 { color: blue }');
    kitWrite(dir, 'tags', 'tags', '{"highlighted": {"label": "Highlighted"}}');
    expect(kitList(dir)).toMatchObject({ styles: ['base'], tags: true, blocks: [] });
    expect(kitTags(dir)).toEqual({ highlighted: { label: 'Highlighted' } });
    expect(lastKitChange(dir)?.label).toBe('add kit/tags.json');
    expect(undoKit(dir)).toBe('add kit/tags.json');
    expect(kitList(dir).tags).toBe(false);
    expect(undoKit(dir)).toBe('edit kit/styles/base.css');
    expect(kitRead(dir, 'styles', 'base')).toBe('h2 { color: red }');
  });

  it('give every page the site styles after the theme and before its own head, and the loader when there are behaviours', () => {
    const dir = site();
    kitWrite(dir, 'styles', 'b-buttons', '.btn { padding: 1px }');
    kitWrite(dir, 'styles', 'a-base', 'body { margin: 0 }');
    expect(kitStyles(dir).indexOf('a-base')).toBeLessThan(kitStyles(dir).indexOf('b-buttons')); // in file-name order
    const ws = pageWorkspace(dir, 'home');
    ws.setHead('<style id="mine">.x{}</style>\n' + ws.head(), 'user');
    const html = ws.page();
    expect(html.indexOf('data-tykerf-theme')).toBeLessThan(html.indexOf('data-tykerf-kit'));
    expect(html.indexOf('data-tykerf-kit')).toBeLessThan(html.indexOf('id="mine"'));
    expect(html).not.toContain('/kit/loader.js');
    kitWrite(dir, 'scripts', 'reveal', 'export default (el) => el.classList.add("shown");');
    expect(pageWorkspace(dir, 'home').page()).toContain('<script type="module" src="/kit/loader.js"></script>');
    // the site head's theme is never written with the kit in it
    expect(readFileSync(join(dir, 'head.html'), 'utf8')).not.toContain('data-tykerf-kit');
  });

  it('go along in an export: styles in each page, the loader and behaviours as files, with relative addresses', () => {
    const dir = site();
    kitWrite(dir, 'styles', 'base', '.btn { padding: 1px }');
    kitWrite(dir, 'scripts', 'reveal', 'export default () => {};');
    const { files, report } = exportFiles(dir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('kit/loader.js');
    expect(paths).toContain('kit/scripts/reveal.js');
    const home = new TextDecoder().decode(files.find((f) => f.path === 'home/index.html')!.bytes);
    expect(home).toContain('src="../kit/loader.js"');
    expect(home).toContain('.btn { padding: 1px }');
    expect(report.broken).toEqual([]);
    expect(new TextDecoder().decode(files.find((f) => f.path === 'kit/loader.js')!.bytes)).toBe(KIT_LOADER);
  });
});

describe('shared blocks', () => {
  it('are written use=<name> on a box, and read back the same', () => {
    const l = parseSlice('nav[role=header use=main-nav] text H@page\n');
    expect(l.root.type === 'op' && l.root.children[0]).toMatchObject({ id: 'nav', use: 'main-nav' });
    expect(serializeSlice(l)).toContain('nav[role=header use=main-nav]');
    expect(() => parseSlice('nav[use=Bad] H@page\n')).toThrow(/bad shared block name/);
    expect(serializeSlice(M.setLeaf(l, 'nav', { use: null }))).not.toContain('use=');
  });

  it('show the same code on every page that links them; a change on one page reaches the others', () => {
    const dir = site();
    const home = pageWorkspace(dir, 'home'), about = pageWorkspace(dir, 'about');
    const before = about.ownContent('footer');
    expect(shareBlock(dir, home, 'nav')).toEqual({ name: 'nav', files: [] });
    linkBlock(dir, about, 'nav', 'nav');
    expect(blockUsers(dir, 'nav')).toEqual({ about: ['nav'], home: ['nav'] });
    home.setContent('nav', '<nav><a href="/home/">Home</a> <a href="/about/">About</a></nav>', 'user');
    expect(kitRead(dir, 'blocks', 'nav')).toContain('About');
    expect(about.content('nav')).toContain('About');
    expect(home.history(1)[0].label).not.toMatch(/set_content nav/); // the change is the site's, not the page's
    // each page marks its own link
    expect(pageWorkspace(dir, 'about').page()).toContain('<a href="/about/" aria-current="page">About</a>');
    expect(pageWorkspace(dir, 'home').page()).toContain('<a href="/home/" aria-current="page">Home</a>');
    expect(markCurrentPage('<a aria-current="page" href="/x/">x</a>', 'x')).toBe('<a aria-current="page" href="/x/">x</a>');
    // making a page's own copy: one undo step, the other page keeps the shared block
    unlinkBlock(about, 'nav');
    expect(about.sharedBlock('nav')).toBeNull();
    expect(about.ownContent('nav')).toContain('About');
    about.setContent('nav', '<nav>only here</nav>', 'user');
    expect(home.content('nav')).toContain('About');
    expect(about.undo()).toMatch(/set_content nav/);
    expect(about.undo()).toBe("make nav this page's own copy of nav");
    expect(about.sharedBlock('nav')).toBe('nav');
    expect(about.ownContent('footer')).toBe(before);
  });

  it('are found among boxes already the same on several pages, and shared in one go', () => {
    const dir = site();
    expect(identicalBoxes(dir).map((g) => g.box)).toEqual(expect.arrayContaining(['nav', 'footer']));
    const r = shareIdentical(dir, 'footer');
    expect(r).toEqual({ name: 'footer', pages: ['about', 'home'], files: [] });
    expect(identicalBoxes(dir).map((g) => g.box)).not.toContain('footer');
    // a new page's box of the same name shows the shared block
    expect(newSitePage(dir, 'news', 'blank', 'studio').load().root.type).toBe('op');
    expect(pageWorkspace(dir, 'news').sharedBlock('footer')).toBeNull(); // the blank layout has no footer
    newSitePage(dir, 'shop', 'catalogue', 'studio');
    expect(pageWorkspace(dir, 'shop').sharedBlock('footer')).toBe('footer');
    expect(pageWorkspace(dir, 'shop').history()).toEqual([]); // a new page starts with nothing to undo
  });

  it('take the page\'s own files they use to the site, so every page shows them', () => {
    const dir = site();
    const home = pageWorkspace(dir, 'home'), about = pageWorkspace(dir, 'about');
    const logo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
    home.store.write('assets/logo.png', logo);
    home.setContent('nav', '<nav><img src="assets/logo.png" srcset="./assets/logo.png 2x" alt="Logo"> <a href="/about/">About</a></nav>\n<style>nav { background: url("assets/logo.png?v=1") }</style>', 'user');
    expect(shareBlock(dir, home, 'nav')).toEqual({ name: 'nav', files: ['logo.png'] });
    expect(new Uint8Array(readFileSync(join(dir, 'assets', 'logo.png')))).toEqual(logo);
    const block = kitRead(dir, 'blocks', 'nav')!;
    expect(block).toContain('src="/assets/logo.png" srcset="/assets/logo.png 2x"');
    expect(block).toContain('url("/assets/logo.png?v=1")');
    expect(pageFileRefs(block)).toEqual([]);
    expect(home.ownContent('nav')).toContain('src="assets/logo.png"'); // the box's own code waits as it was
    linkBlock(dir, about, 'nav', 'nav');
    for (const p of ['home', 'about']) {
      const ws = pageWorkspace(dir, p);
      expect(ws.page()).toContain('<img src="/assets/logo.png"');
      expect(leftovers(ws).filter((l) => l.box === 'nav' && ['missing', 'shared-file'].includes(l.kind))).toEqual([]);
    }
    // the same file again: nothing to copy; another file of the same name: the site's stays, the copy gets a hashed name
    home.setContent('cta', '<p><img src="assets/logo.png" alt=""></p>', 'user');
    expect(shareBlock(dir, home, 'cta')).toEqual({ name: 'cta', files: [] });
    expect(kitRead(dir, 'blocks', 'cta')).toContain('src="/assets/logo.png"');
    const other = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);
    about.store.write('assets/logo.png', other);
    about.setContent('footer', '<footer><img src="assets/logo.png" alt=""></footer>', 'user');
    const hashed = `logo-${contentHash(other)}.png`;
    expect(shareBlock(dir, about, 'footer')).toEqual({ name: 'footer', files: [hashed] });
    expect(kitRead(dir, 'blocks', 'footer')).toContain(`src="/assets/${hashed}"`);
    expect(new Uint8Array(readFileSync(join(dir, 'assets', 'logo.png')))).toEqual(logo);
    expect(new Uint8Array(readFileSync(join(dir, 'assets', hashed)))).toEqual(other);
  });

  it('report a shared block that uses a page\'s own file, and warn when one is saved that way', () => {
    const dir = site();
    shareBlock(dir, pageWorkspace(dir, 'home'), 'nav');
    linkBlock(dir, pageWorkspace(dir, 'about'), 'nav', 'nav');
    kitWrite(dir, 'blocks', 'nav', '<nav><img src="assets/x.png" alt=""></nav>'); // written by hand: saved
    expect(kitWarning('blocks', 'nav', kitRead(dir, 'blocks', 'nav')!)).toMatch(/assets\/x\.png is a page's file.*write \/assets\/x\.png/);
    expect(kitWarning('blocks', 'nav', '<nav><img src="/assets/x.png" alt=""></nav>')).toBeNull();
    expect(kitWarning('styles', 'base', 'a { background: url(assets/x.png) }')).toBeNull();
    for (const p of ['home', 'about']) {
      expect(leftovers(pageWorkspace(dir, p)).filter((l) => l.kind === 'shared-file').map(say))
        .toEqual(['nav: the shared block nav uses assets/x.png, a page\'s file; shared blocks use /assets/x.png (the site\'s)']);
    }
  });

  it('report a box whose shared block is gone', () => {
    const dir = site();
    const home = pageWorkspace(dir, 'home');
    shareBlock(dir, home, 'cta');
    kitWrite(dir, 'blocks', 'cta', null);
    const left = leftovers(pageWorkspace(dir, 'home')).filter((l) => l.kind === 'block');
    expect(left.map(say)).toEqual(['cta: it shows the shared block "cta", which the site\'s kit doesn\'t have (kit/blocks/cta.html), so it shows its own code']);
  });
});

describe('site types and tags', () => {
  it('give every page the kit\'s box types, a page\'s own type of the same name winning', () => {
    const dir = site();
    kitWrite(dir, 'types', 'card', JSON.stringify({ content: { scripts: false } }));
    const ws = pageWorkspace(dir, 'home');
    expect(ws.types().card).toEqual({ content: { scripts: false } });
    ws.save(M.setLeaf(ws.load(), 'cta', { boxType: 'card' }), 'type', 'user');
    expect(() => ws.setContent('cta', '<p>x</p><script>1</script>', 'user')).toThrow(/refused by box type/);
    ws.store.write('types/card.json', JSON.stringify({ content: { scripts: true } }));
    expect(ws.types().card).toEqual({ content: { scripts: true } });
  });
});

describe('the kit tools', () => {
  it('change the kit and link blocks on a run over the whole site, and refuse a run on one block', async () => {
    const dir = site();
    const { openTools } = await import('../src/editor/tools-client.js');
    const home = pageWorkspace(dir, 'home');
    const whole = await openTools(home, '', dir);
    expect((await whole.call('list_kit', {})).text).toMatch(/^styles: none/);
    expect((await whole.call('set_kit_file', { kind: 'styles', name: 'base', text: '.btn{}' })).text).toMatch(/reaches every page of the site \(2\)/);
    home.store.write('assets/logo.png', new Uint8Array([1, 2, 3]));
    home.setContent('nav', '<nav><img src="assets/logo.png" alt="Logo"></nav>', 'user');
    expect((await whole.call('share_block', { id: 'nav' })).text).toBe('ok: "nav" is now the shared block "nav"; its file went to the site\'s assets/, for every page: logo.png');
    expect((await whole.call('list_kit', {})).text).toMatch(/blocks: nav \(on home\)/);
    await whole.call('open_page', { name: 'about' });
    expect((await whole.call('link_block', { id: 'nav', name: 'nav' })).text).toBe('ok: "nav" shows the shared block "nav"');
    expect((await whole.call('set_kit_file', { kind: 'blocks', name: 'nav', text: '<nav><img src="assets/logo.png" alt=""></nav>' })).text).toMatch(/\nwarning: nav: assets\/logo\.png is a page's file/);
    expect((await whole.call('check_page', {})).text).toContain('nav: the shared block nav uses assets/logo.png, a page\'s file; shared blocks use /assets/logo.png (the site\'s)');
    expect((await whole.call('set_kit_file', { kind: 'blocks', name: 'nav', text: '<nav>one</nav>' })).text).toMatch(/the pages that show it: about, home/);
    await whole.close();
    expect(lastKitChange(dir)?.author).toBe('ai');

    // Kaity on one block: no kit tools, and the shared block can't change from there
    const narrow = await openTools(pageWorkspace(dir, 'home'), 'nav');
    expect((await narrow.call('list_kit', {})).text).toMatch(/not found|unknown tool|error/i);
    expect((await narrow.call('set_content', { id: 'nav', html: '<nav>two</nav>' })).text).toMatch(/refused: "nav" shows the shared block "nav"/);
    await narrow.close();
    expect(kitRead(dir, 'blocks', 'nav')).toBe('<nav>one</nav>');
    expect(existsSync(join(dir, 'kit', 'styles', 'base.css'))).toBe(true);
  });
});
