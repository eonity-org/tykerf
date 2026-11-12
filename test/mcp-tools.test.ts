import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createTykerfServer } from '../src/mcp/tools.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

/** Every tool, as a client lists it: on a folder (home), so the site's page tools are there too, and open_folder. */
async function tools() {
  const server = createTykerfServer(new Workspace(new MemoryStore('memory:tools')), { home: process.cwd(), folders: { defaultDir: process.cwd() } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools: list } = await client.listTools();
  await client.close();
  return new Map(list.map((t) => [t.name, t]));
}

describe('the MCP tools', () => {
  it('report the package\'s version', async () => {
    const server = createTykerfServer(new Workspace(new MemoryStore('memory:version')));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(client.getServerVersion()?.version).toBe(version);
    await client.close();
  });

  it('each say what they do to the page: a title, read-only or not, and whether a change replaces something', async () => {
    const all = await tools();
    for (const [name, t] of all) {
      expect(t.title, name).toMatch(/^[A-Z]/);
      expect(typeof t.annotations?.readOnlyHint, name).toBe('boolean');
      expect(typeof t.annotations?.openWorldHint, name).toBe('boolean');
      if (!t.annotations?.readOnlyHint) expect(typeof t.annotations?.destructiveHint, name).toBe('boolean');
    }
    expect(new Set([...all.values()].map((t) => t.title)).size).toBe(all.size);
  });

  it('mark what only reads, what replaces, and what may reach other servers', async () => {
    const all = await tools();
    const hints = (name: string) => all.get(name)?.annotations;
    for (const name of ['get_layout', 'get_content', 'list_pages', 'open_page', 'open_folder', 'check_page']) expect(hints(name), name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    for (const name of ['edit_content', 'split', 'undo', 'new_page']) expect(hints(name), name).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const name of ['use_layout', 'use_page', 'set_content', 'remove']) expect(hints(name), name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    // Chromium renders the page, whose code may load files from other servers
    for (const name of ['screenshot', 'evaluate']) expect(hints(name), name).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('says where a cut screenshot ends, and shows the rest from there', async () => {
    const ws = new Workspace(new MemoryStore('memory:tall'));
    ws.create('long end H', { long: '<div style="height:3000px">long</div>', end: '<p>end</p>' });
    const server = createTykerfServer(ws);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const said = async (args: Record<string, unknown>) => ((await client.callTool({ name: 'screenshot', arguments: args })) as { content: { text?: string }[] }).content.map((c) => c.text ?? '').join('');
    try {
      expect(await said({ width: 800 })).toMatch(/^the whole page at 800 px wide; this is 0–2000 px of \d+; for the rest, call screenshot again with from: 2000\.$/);
      expect(await said({ width: 800, from: 2000 })).toMatch(/^the whole page at 800 px wide; this is 2000–\d+ px of \d+\.$/);
      expect(await said({ width: 800, id: 'end' })).toMatch(/^\w+\/end: 800×\d+ px \(dashed red frame\), with 24 px around it at 800 px wide\.$/);
    } finally {
      await client.close();
      const { closeScreenshots } = await import('../src/screenshot.js');
      await closeScreenshots();
    }
  });
});

describe("a page's screenshot", () => {
  it("has the site kit's styles: the stylesheet every page links is served to it", async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { kitWrite } = await import('../src/kit.js');
    const { Site } = await import('../src/site.js');
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-kit-shot-'));
    kitWrite(dir, 'styles', 'tall', '[data-sw="end"] { min-height: 5000px }');
    const ws = new Workspace(new MemoryStore('memory:kit-shot'), { site: new Site(dir) });
    ws.create('top end H', { top: '<p>top</p>', end: '<p>end</p>' });
    const server = createTykerfServer(ws);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const said = ((await client.callTool({ name: 'screenshot', arguments: { width: 800 } })) as { content: { text?: string }[] }).content.map((c) => c.text ?? '').join('');
      expect(Number(/ of (\d+)/.exec(said)![1])).toBeGreaterThan(5000); // the kit's rule made the page that tall
    } finally {
      await client.close();
      const { closeScreenshots } = await import('../src/screenshot.js');
      await closeScreenshots();
    }
  });
});

describe('the slots of a shared block', () => {
  it('are listed by get_content and get_layout, and filled by set_slot or an edit inside them, in the box\'s scope', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { kitRead, kitWrite } = await import('../src/kit.js');
    const { componentCode } = await import('../src/library.js');
    const { newSitePage, pageWorkspace } = await import('../src/site.js');
    const M = await import('../src/moves.js');
    const { openTools } = await import('../src/editor/tools-client.js');
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-slots-'));
    newSitePage(dir, 'home', 'launch', 'studio');
    newSitePage(dir, 'about', 'company', 'studio');
    const banner = componentCode('page-banner');
    kitWrite(dir, 'blocks', 'banner', banner);
    const home = pageWorkspace(dir, 'home');
    home.save(M.setLeaf(home.load(), 'logos', { use: 'banner' }), 'link', 'user');

    const box = await openTools(pageWorkspace(dir, 'home'), 'logos'); // Kaity on that one box
    expect((await box.call('get_content', { id: 'logos' })).text).toMatch(/\n\nslots: title \(fallback\), lead \(fallback\)\. set_slot fills one for this page/);
    expect((await box.call('get_layout', {})).text).toContain('use=banner (shared block, slots: title, lead)');
    expect((await box.call('set_slot', { id: 'logos', slot: 'title', html: 'Our story' })).text)
      .toBe('ok: the slot "title" of "logos" is set for this page; the other pages that show banner keep theirs, and the block didn\'t change');
    expect((await box.call('get_content', { id: 'logos' })).text).toMatch(/slots: title \(filled: "Our story"\), lead \(fallback\)/);
    // an edit inside a slot is the page's too; outside one, it would change every page, which this scope can't
    expect((await box.call('edit_content', { id: 'logos', old: 'One sentence that says what this page is about.', new: 'Since 1952.' })).text)
      .toBe('ok: 1 change in "logos"; this page\'s slot lead of the shared block banner (the other pages keep theirs); the shared block itself didn\'t change');
    expect((await box.call('edit_content', { id: 'logos', old: 'max-width: 22ch', new: 'max-width: 30ch' })).text).toMatch(/refused: "logos" shows the shared block "banner"/);
    expect((await box.call('set_slot', { id: 'logos', slot: 'subtitle', html: 'x' })).text).toMatch(/has no slot "subtitle" \(slots: title, lead\)/);
    await box.close();
    expect(kitRead(dir, 'blocks', 'banner')).toBe(banner);
    expect(pageWorkspace(dir, 'home').slots('logos').map((s) => s.value)).toEqual(['Our story', 'Since 1952.']);

    // another block's scope can't fill it
    const other = await openTools(pageWorkspace(dir, 'home'), 'hero');
    expect((await other.call('set_slot', { id: 'logos', slot: 'title', html: 'x' })).text).toMatch(/refused/);
    await other.close();
    const again = await openTools(pageWorkspace(dir, 'home'), 'logos');
    expect((await again.call('set_slot', { id: 'logos', slot: 'title', html: null })).text).toMatch(/shows the shared block banner's own text again/);
    await again.close();
  });
});
