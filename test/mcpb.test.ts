// The Claude Desktop extension: the bundled MCP server starts on its own (no tsx, no repository),
// lists the same tools as the factory, and edits a page folder.

import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpb } from '../scripts/build-mcpb.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 60_000 });

describe('the Claude Desktop extension', () => {
  it('builds a valid bundle whose server edits a page and takes screenshots', async () => {
    const out = await buildMcpb(join(mkdtempSync(join(tmpdir(), 'tykerf-mcpb-')), 'mcpb'), { pack: false });
    const manifest = (await import(join(out, 'manifest.json'), { with: { type: 'json' } })).default;
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/server/index.js', '--dir', '${user_config.page_folder}']);

    const dir = mkdtempSync(join(tmpdir(), 'tykerf-mcpb-page-'));
    cpSync('examples/widgets', dir, { recursive: true, filter: (f) => !/\/(out|\.tykerf)(\/|$)|history/.test(f) });
    // run from another folder, as Claude Desktop does: nothing may come from the repository
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, 'server', 'index.js'), '--dir', dir], cwd: tmpdir(), stderr: 'pipe' }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(manifest.tools.map((t: { name: string }) => t.name).sort());
      const layout = await client.callTool({ name: 'get_layout', arguments: {} });
      expect((layout.content as any)[0].text).toMatch(/column|row/);
      const comps = await client.callTool({ name: 'list_components', arguments: {} });
      expect((comps.content as any)[0].text).toMatch(/hero/); // the library came along
      const leaf = new Workspace(dir).boxIds()[0];
      const set = await client.callTool({ name: 'set_content', arguments: { id: leaf, html: '<p>from Desktop</p>' } });
      expect(set.isError).toBeFalsy();
      expect(new Workspace(dir).content(leaf)).toContain('from Desktop');
      const shot = await client.callTool({ name: 'screenshot', arguments: { width: 375 } });
      expect((shot.content as any)[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    } finally {
      await client.close();
    }
  });
});
