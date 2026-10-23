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
