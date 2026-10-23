// MCP server over stdio: lets an AI edit a page through slicing-tree moves that can never leave the
// layout invalid. State lives in a workspace directory (see workspace.ts); the tools are in tools.ts.
//
//   claude mcp add tykerf -- npx tsx src/mcp/server.ts --dir examples/widgets
//   … server.ts --lazy [--dir <default>]   no folder open until open_folder opens one (the Claude plugin)

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { siteOf } from '../site.js';
import { Workspace } from '../workspace.js';
import { createTykerfServer, folderPath } from './tools.js';

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (process.argv.includes('--lazy')) {
  // the Claude plugin: Cowork can't ask for a folder on install, so none is open until Claude opens one. Without a path it
  // opens the default: --dir (Claude Code's page_folder setting), else TYKERF_DIR (the environment, or a .env in the
  // folder the server starts in, as the editor reads it), else ~/TYKERF. A setting left empty may arrive as "" or unfilled.
  if (process.env.TYKERF_DOTENV !== 'off' && existsSync('.env')) process.loadEnvFile('.env');
  const given = [flag('--dir'), process.env.TYKERF_DIR].map((v) => v?.trim()).find((v) => v && !v.startsWith('${'));
  const defaultDir = folderPath(given ?? '~/TYKERF');
  await createTykerfServer(null, { scope: flag('--scope') ?? null, folders: { defaultDir } }).connect(new StdioServerTransport());
} else {
  // a folder pasted into a setting (Claude Desktop's "Page folder") easily brings a space at either end
  const dir = resolve((flag('--dir') ?? process.env.TYKERF_DIR ?? '.').trim());
  if (!existsSync(join(dir, 'layout.slice'))) console.error(`TYKERF: no page in ${dir} itself: in a site, open_page and new_page work on its pages; in an empty folder, use_layout starts one`);
  // a page of a site renders with the site's shared head (its theme)
  const ws = new Workspace(dir, { site: siteOf(dir) });
  // --scope: the block of one editor AI run (see tools.ts)
  // the folder may be a site, or a page of one: the client can then list, open and make its pages
  await createTykerfServer(ws, { scope: flag('--scope') ?? null, home: dir }).connect(new StdioServerTransport());
}
