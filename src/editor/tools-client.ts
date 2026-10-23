// TYKERF's MCP tools in the editor's own process, for the API runners (runners/). The tools are the
// ones the stdio server gives Claude Code (mcp/tools.ts), linked through an in-memory MCP transport,
// so an API model gets exactly the same tools, scope checks, refusals and history labels.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTykerfServer } from '../mcp/tools.js';
import { Workspace } from '../workspace.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema of the arguments
}

/** What a tool answered: its text, the pictures it returned (screenshots) and whether it refused. */
export interface ToolOutput {
  text: string;
  images: { mediaType: string; data: string }[];
  isError: boolean;
}

export interface Tools {
  list: ToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<ToolOutput>;
  close(): Promise<void>;
}

/**
 * The tools over a page, limited to the block `scope`. They work on their own Workspace object (over
 * the same store), so the editor's lock on the block during a run (a guard on the editor's object)
 * doesn't refuse the AI's own changes; the store lock still keeps every change whole.
 */
export async function openTools(ws: Workspace, scope: string, home?: string): Promise<Tools> {
  // a run on the whole site has no block to keep to, and works on the site's pages from its folder
  const server = createTykerfServer(new Workspace(ws.store, { site: ws.site }), { scope: scope || null, home: home ?? null });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tykerf-editor', version: '0.2.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  return {
    list: tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })),
    async call(name, args) {
      try {
        const r = await client.callTool({ name, arguments: args });
        const content = (r.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[];
        return {
          text: content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'),
          images: content.filter((c) => c.type === 'image' && c.data).map((c) => ({ mediaType: c.mimeType ?? 'image/png', data: c.data! })),
          isError: !!r.isError,
        };
      } catch (e) {
        return { text: `error: ${(e as Error).message}`, images: [], isError: true };
      }
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
