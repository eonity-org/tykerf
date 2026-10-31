import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import * as M from '../src/moves.js';
import { componentCode, createPage, hasTheme, themeVariables } from '../src/library.js';
import { pageMoves, sitePages } from '../src/site.js';
import { Workspace } from '../src/workspace.js';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

function page(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-mcp-'));
  cpSync('examples/widgets', dir, { recursive: true });
  return dir;
}

async function connect(...args: string[]) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/server.ts', ...args], stderr: 'ignore' }));
  clients.push(client);
  return async (name: string, a: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: a })) as { content: { text?: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text ?? '').join('\n'), error: !!r.isError };
  };
}

describe('the page folder', () => {
  it('is found even with a space around it, as a path pasted into a setting often has', async () => {
    const call = await connect('--dir', ` ${page()} `);
    expect(await call('get_layout')).toMatchObject({ error: false, text: expect.stringMatching(/^page column/) });
  });

  it('can be empty, or not there yet: use_layout starts a site in it, with its home page', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'tykerf-mcp-new-')), 'rome');
    const call = await connect('--dir', dir);
    expect(await call('get_layout')).toMatchObject({ error: true, text: expect.stringMatching(/no page is open\..* In an empty folder, use_layout starts a site with its home page/) });
    expect((await call('list_layouts')).text).toMatch(/^blank: /m);
    const made = await call('use_layout', { name: 'factual', theme: 'warm' });
    expect(made).toMatchObject({ error: false, text: expect.stringMatching(/^ok: a new site in .*rome, with its home page "home" from the factual layout with the warm theme/) });
    expect((await call('get_layout')).text).toMatch(/nav leaf/);
    expect(existsSync(join(dir, 'home', 'layout.slice'))).toBe(true);
    expect(readFileSync(join(dir, 'head.html'), 'utf8')).toContain('data-tykerf-preset="warm"'); // the site's theme, shared with its later pages
    // then it is a page like any other: use_layout replaces its blocks, and keeps its theme
    expect((await call('use_layout', { name: 'blank' })).text).toMatch(/^ok: the page now follows the blank layout/);

    // a run limited to one block can't start a page
    const scoped = await connect('--dir', join(dir, '..', 'other'), '--scope', 'main');
    expect(await scoped('use_layout', { name: 'blank' })).toMatchObject({ error: true, text: expect.stringMatching(/refused: there is no page here yet/) });
  });
});

describe('a site of pages', () => {
  it('lists, opens and makes pages; every other tool works on the open one', async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-mcp-site-')), 'cities');
    for (const name of ['rome', 'prague']) createPage(new Workspace(join(site, name)), 'blank');
    const call = await connect('--dir', site);
    expect(await call('get_layout')).toMatchObject({ error: true, text: expect.stringMatching(/no page is open\. In a site, open_page opens one of its pages \(list_pages lists them\)/) });
    expect((await call('list_pages')).text).toBe(`site ${site}\nprague\nrome\nno page is open: open_page opens one`);
    // a page made right in the site folder would hide its pages
    expect(await call('use_layout', { name: 'blank' })).toMatchObject({ error: true, text: expect.stringMatching(/refused: this folder is a site of pages \(prague, rome\)/) });

    expect((await call('open_page', { name: 'rome' })).text).toMatch(/^ok: "rome" is open\n\npage column/);
    await call('edit_content', { id: 'nav', old: 'Site name', new: 'Roma' });
    expect(readFileSync(join(site, 'rome', 'boxes', 'nav.html'), 'utf8')).toContain('Roma');
    expect((await call('list_pages')).text).toContain('rome (open)');
    expect(await call('open_page', { name: 'munich' })).toMatchObject({ error: true, text: expect.stringMatching(/no page "munich" in the site \(pages: prague, rome\)/) });

    const made = await call('new_page', { name: 'munich', layout: 'factual', theme: 'warm' });
    expect(made.text).toMatch(/^ok: new page "munich" from the factual layout, with the warm theme; it is open now/);
    expect(readFileSync(join(site, 'munich', 'head.html'), 'utf8')).toContain('data-tykerf-preset="warm"');
    expect((await call('get_layout')).text).toMatch(/intro leaf/);
    expect((await call('list_pages')).text).toBe(`site ${site}\nmunich (open)\nprague\nrome`);
    expect((await call('new_page', { name: 'Bad Name' })).text).toMatch(/can't be a page name/);
  });

  it('renames and removes pages: links follow a rename, a removed page goes to the trash, and the editor hears of both', async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-mcp-site-')), 'cities');
    for (const name of ['page-one', 'page-two']) createPage(new Workspace(join(site, name)), 'blank');
    const two = new Workspace(join(site, 'page-two'));
    two.setContent(two.boxIds()[0], '<p><a href="/page-one/">Madrid</a></p>', 'user');
    const call = await connect('--dir', site);
    await call('open_page', { name: 'page-one' });
    expect((await call('rename_page', { name: 'page-one', to: 'madrid' })).text).toBe('ok: "page-one" is "madrid" now, at /madrid/; links to it on 1 page follow; it is still the open page');
    expect(readFileSync(join(site, 'page-two', 'boxes', `${two.boxIds()[0]}.html`), 'utf8')).toContain('href="/madrid/"');
    expect((await call('list_pages')).text).toBe(`site ${site}\nmadrid (open)\npage-two`);
    expect((await call('rename_page', { name: 'page-two', to: 'Bad Name' })).text).toMatch(/can't be a page name/);
    expect((await call('remove_page', { name: 'madrid' })).text).toBe('ok: "madrid" is in the site\'s trash; 1 link on other pages still leads to /madrid/: change or remove them. No page is open now: open_page opens one');
    expect(sitePages(site)).toEqual(['page-two']);
    expect(pageMoves(site).map(({ from, to }) => [from, to])).toEqual([['page-one', 'madrid'], ['madrid', null]]);
    expect((await call('get_layout')).text).toMatch(/no page is open/);
  });

  it('started on one page, can reach the others; a run on one block cannot', async () => {
    const site = mkdtempSync(join(tmpdir(), 'tykerf-mcp-site-'));
    for (const name of ['rome', 'prague']) createPage(new Workspace(join(site, name)), 'blank');
    const call = await connect('--dir', join(site, 'rome'));
    expect((await call('list_pages')).text).toBe(`site ${site}\nprague\nrome (open)`);
    expect((await call('open_page', { name: 'prague' })).error).toBe(false);
    const scoped = await connect('--dir', join(site, 'rome'), '--scope', 'nav');
    expect(await scoped('list_pages')).toMatchObject({ error: true, text: expect.stringMatching(/list_pages not found/) }); // not offered at all
    expect((await scoped('new_page', { name: 'x' })).error).toBe(true);
  });

  it('makes a page like another one: use_page on the open page, copy for a new one', async () => {
    const site = mkdtempSync(join(tmpdir(), 'tykerf-mcp-site-'));
    createPage(new Workspace(join(site, 'rome')), 'factual', 'warm');
    createPage(new Workspace(join(site, 'munich')), 'blank', 'studio');
    const call = await connect('--dir', join(site, 'munich'));
    expect((await call('use_page', { page: 'rome' })).text).toMatch(/^ok: the page now has the blocks of "rome"; rewrite their text/);
    expect(readFileSync(join(site, 'munich', 'layout.slice'), 'utf8')).toMatch(/intro/);
    expect(readFileSync(join(site, 'munich', 'head.html'), 'utf8')).toContain('data-tykerf-preset="studio"');
    const copied = await call('new_page', { name: 'prague', copy: 'rome' });
    expect(copied.text).toMatch(/^ok: new page "prague", a copy of "rome"; it is open now/);
    expect(readFileSync(join(site, 'prague', 'head.html'), 'utf8')).toContain('data-tykerf-preset="warm"');

    // a run on one block: only the whole page may be replaced, and the site's page tools are not offered
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/server.ts', '--dir', join(site, 'munich'), '--scope', 'nav'], stderr: 'ignore' }));
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('use_page');
    expect(names).not.toContain('list_pages');
    const r = (await client.callTool({ name: 'use_page', arguments: { page: 'rome' } })) as { content: { text: string }[] };
    expect(r.content[0].text).toMatch(/refused: copying a page replaces the whole page, and the scope is "nav"/);
  });
});

describe('the MCP server scope', () => {
  it('--scope limits one run, follows its renames and leaves .scope alone', async () => {
    const dir = page();
    const call = await connect('--dir', dir, '--scope', 'row2');
    expect((await call('get_layout')).text).toMatch(/^scope: page\/row2 \(set by user\)/);
    expect(await call('set_content', { id: 'footer', html: '<p>x</p>' })).toMatchObject({ error: true });
    expect(await call('unfocus')).toMatchObject({ error: true });
    expect(await call('set_content', { id: 'faq', html: '<p>ok</p>' })).toMatchObject({ error: false });
    expect(await call('rename', { ref: 'row2', new_name: 'lower' })).toMatchObject({ error: false });
    expect((await call('get_layout')).text).toMatch(/^scope: page\/lower/);
    expect(await call('set_content', { id: 'lower/1', html: '<p>still in scope</p>' })).toMatchObject({ error: false });
    expect(await call('set_content', { id: 'title', html: '<p>x</p>' })).toMatchObject({ error: true });
    expect(new Workspace(dir).scopeSetting()).toBeNull();
  }, 30_000);

  it('refuses everything when the block of a user scope is gone, instead of lifting it', async () => {
    const dir = page();
    const ws = new Workspace(dir);
    ws.setScope('pricing', 'user');
    const call = await connect('--dir', dir);
    expect((await call('get_layout')).text).toMatch(/^scope: page\/pricing/);
    ws.save(M.remove(ws.load(), 'pricing'), 'remove pricing', 'user');
    const r = await call('set_content', { id: 'title', html: '<p>x</p>' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toMatch(/no longer exists/);
    expect(await call('swap', { a: 'title', b: 'footer' })).toMatchObject({ error: true });
  }, 30_000);

  it('edit_content changes part of a box, once or everywhere, inside the scope only', async () => {
    const dir = page();
    const call = await connect('--dir', dir, '--scope', 'row2');
    expect(await call('set_content', { id: 'faq', html: '<p>one</p><p>one</p><p>two</p>' })).toMatchObject({ error: false });
    expect(await call('edit_content', { id: 'faq', old: 'two', new: 'three' })).toMatchObject({ error: false });
    expect(await call('edit_content', { id: 'faq', old: 'one', new: 'x' })).toMatchObject({ error: true }); // twice: ambiguous
    expect(await call('edit_content', { id: 'faq', old: 'one', new: '$&', all: true })).toMatchObject({ error: false });
    expect(await call('edit_content', { id: 'faq', old: 'missing', new: 'x' })).toMatchObject({ error: true });
    expect(await call('edit_content', { id: 'footer', old: 'x', new: 'y' })).toMatchObject({ error: true }); // outside the scope
    expect(new Workspace(dir).content('faq')!.trim()).toBe('<p>$&</p><p>$&</p><p>three</p>');
  }, 30_000);

  it('get_content and set_content take the same references as the moves', async () => {
    const dir = page();
    const call = await connect('--dir', dir);
    expect(await call('set_content', { id: 'page/row2/2', html: '<p>by path</p>' })).toMatchObject({ error: false });
    expect((await call('get_content', { id: '#4.2' })).text).toBe('<p>by path</p>\n');
    expect(await call('normalize')).toMatchObject({ error: false });
  }, 30_000);
});

describe('the MCP component tools', () => {
  it('list the components and fill a box with one in one undo step, adding the theme variables', async () => {
    const dir = page();
    const before = new Workspace(dir).content('signup');
    const call = await connect('--dir', dir);
    expect((await call('list_components')).text).toMatch(/^nav: Navigation bar\. Brand, links and a button$/m);
    const r = await call('use_component', { id: 'row2/1', name: 'contact' });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/^ok: "signup" now holds the contact component \(the theme variables were added/);
    const ws = new Workspace(dir);
    expect(ws.content('signup')).toBe(componentCode('contact').trim() + '\n');
    expect(hasTheme(ws.head())).toBe(true);
    expect(ws.history(1)[0]).toMatchObject({ label: 'use component contact in signup', author: 'ai', kind: 'group' });
    expect(await call('undo')).toMatchObject({ error: false });
    expect(ws.content('signup')).toBe(before);
    expect(ws.head()).toBe('');
  }, 30_000);

  it('stay inside the scope and leave the head alone unless the whole page is in scope', async () => {
    const dir = page();
    const call = await connect('--dir', dir, '--scope', 'row2');
    const r = await call('use_component', { id: 'signup', name: 'contact' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toMatch(/no theme yet/);
    new Workspace(dir).setHead(themeVariables(), 'user');
    expect(await call('use_component', { id: 'signup', name: 'contact' })).toMatchObject({ error: false });
    expect((await call('use_component', { id: 'footer', name: 'footer' })).text).toMatch(/outside the scope/);
    expect((await call('use_component', { id: 'row2', name: 'contact' })).text).toMatch(/is not a box/);
    expect((await call('use_component', { id: 'faq', name: 'nope' })).text).toMatch(/unknown component "nope"/);
  }, 30_000);

  it('change nothing when the box type refuses the component', async () => {
    const dir = page();
    const call = await connect('--dir', dir);
    const r = await call('use_component', { id: 'faq', name: 'hero' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toMatch(/refused by box type/);
    const ws = new Workspace(dir);
    expect(ws.head()).toBe('');
    expect(ws.history()).toEqual([]);
  }, 30_000);
});
