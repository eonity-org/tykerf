// Build the Claude Desktop extension: TYKERF's MCP server as one bundled file, with the page
// library (layouts, components, themes, fonts) and Playwright next to it, a manifest, and the packed .mcpb file.
//
//   npm run build:mcpb                 -> dist/mcpb/ (the bundle) and dist/tykerf.mcpb
//
// Claude Desktop runs the server with its own Node.js and asks for the page folder on install. The
// thinking is done by Claude Desktop with the user's account: the extension holds no key.
// Screenshots and checks work where Chromium is installed (npx playwright install chromium);
// every other tool works without it.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { build } from 'esbuild';
import { createTykerfServer } from '../src/mcp/tools.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The tools, as the manifest lists them (name and the first sentence of the description). */
export async function toolList() {
  // as Claude Desktop starts it: on a folder (home), so the site's page tools are listed too
  const server = createTykerfServer(new Workspace(new MemoryStore('memory:manifest')), { home: root });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'build', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({ name: t.name, description: (t.description ?? '').split(/(?<=\.)\s/)[0] }));
}

/**
 * The MCP server as one readable file, `<out>/server/index.js`, with the page library beside it (library.ts finds its
 * folder next to the code: <out>/server/../library). Playwright stays outside: the extension and the plugin each bring it.
 */
export async function bundleServer(out: string) {
  await build({
    entryPoints: [join(root, 'src', 'mcp', 'server.ts')],
    outfile: join(out, 'server', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // loaded only for screenshots and checks
    external: ['playwright', 'playwright-core'],
    // some dependencies are CommonJS and call require()
    banner: { js: "import { createRequire as __tykerfRequire } from 'node:module'; const require = __tykerfRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  cpSync(join(root, 'library'), join(out, 'library'), { recursive: true });
}

export async function buildMcpb(out = join(root, 'dist', 'mcpb'), opts: { pack?: boolean } = {}): Promise<string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'server'), { recursive: true });

  await bundleServer(out);
  for (const p of ['playwright', 'playwright-core']) cpSync(join(root, 'node_modules', p), join(out, 'server', 'node_modules', p), { recursive: true, dereference: true });
  cpSync(join(root, 'src', 'editor', 'public', 'brand', 'png', 'tykerf-app-icon-512.png'), join(out, 'icon.png'));
  cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'));

  const manifest = {
    manifest_version: '0.3',
    name: 'tykerf',
    display_name: 'TYKERF',
    version: pkg.version,
    description: 'Change a web page block by block: Claude edits a TYKERF page through validated moves on its tree of blocks, and every change can be undone.',
    long_description:
      'TYKERF pages are trees of blocks (rows, columns and boxes of HTML). With this extension Claude reads and changes a TYKERF page folder on your computer through ' +
      'named, validated moves instead of rewriting HTML: it can split, group, move and resize blocks, write a box\'s code, use ready-made components, change the theme, ' +
      'add responsive rules, and look at the result with screenshots. Every change is recorded in the page\'s history and can be undone, also from the TYKERF editor. ' +
      'Ask Claude to focus on one block to keep every other part of the page safe. Screenshots and layout checks need Chromium (npx playwright install chromium).',
    author: { name: 'eonity.org', url: 'https://eonity.org' },
    repository: { type: 'git', url: 'https://github.com/eonity-org/tykerf' },
    homepage: 'https://github.com/eonity-org/tykerf',
    documentation: 'https://github.com/eonity-org/tykerf/blob/main/docs/user-guide/en/claude-desktop.md',
    support: 'https://github.com/eonity-org/tykerf/issues',
    icon: 'icon.png',
    license: 'Apache-2.0',
    keywords: ['web page', 'layout', 'editor', 'html', 'slicing tree'],
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.js', '--dir', '${user_config.page_folder}'] },
    },
    user_config: {
      page_folder: {
        type: 'directory',
        title: 'Page folder',
        description: 'The TYKERF page to edit (a folder with a layout.slice), or an empty folder: Claude then starts the page there from a layout.',
        required: true,
      },
    },
    tools: await toolList(),
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=20.0.0' } },
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const mcpb = join(root, 'node_modules', '.bin', 'mcpb');
  execFileSync(mcpb, ['validate', join(out, 'manifest.json')], { stdio: 'pipe' });
  if (opts.pack === false) return out;
  const file = join(dirname(out), 'tykerf.mcpb');
  execFileSync(mcpb, ['pack', out, file], { stdio: 'pipe' });
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = await buildMcpb();
  console.log(`built ${file}`);
}
