// Build the Claude plugin for Anthropic's directory: TYKERF's MCP server as one readable bundled file (shared with
// the extension), the page library, the plugin manifest and MCP config, the script that starts the server, and the
// part of Playwright that screenshots need. The README, the skills and the license come from plugin/ and the root.
//
//   npm run build:plugin               -> dist/plugin/ (the plugin folder, at its root) and dist/tykerf-plugin.zip
//
// The .zip is the same folder in one file, for Claude Desktop's plugin upload (it takes .zip or .plugin, not a folder
// or a .mcpb): plugin.json is at .claude-plugin/plugin.json inside it, not under a top folder.
//
// The server starts with no folder open (--lazy): Cowork can't ask for one on install, so Claude opens one with
// open_folder, the default when the person names none. Plan and checks: docs/plans/claude-plugin.md.
//
// The directory's rules (for a Verified organization's plugin with a local MCP server): the command is a plain shell
// script at a literal path under CLAUDE_PLUGIN_ROOT, using no variable but CLAUDE_PLUGIN_ROOT; no node_modules (the
// code the plugin needs in its own files); every package.json a plain object of the fields it lists.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleServer } from './build-mcpb.js';
import { zip } from '../src/zip.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/eonity-org/tykerf';
/**
 * Playwright goes in the plugin: Cowork runs what a plugin ships but doesn't install its packages, so screenshots
 * need it inside (Claude Code then uses the same files). Not as a package in node_modules, which the directory
 * refuses, but as the plugin's own files in server/playwright-core/, which the bundled server imports by that path.
 * Only what launching Chromium needs, with the licenses: of `playwright-core` (`playwright` only re-exports it), the
 * browser-install scripts (bin/), the trace viewer, recorder and report apps (lib/vite/), the command line's tools and
 * skills (lib/tools/), the entry points for the browser download, daemon, dashboard and MCP server (lib/entry/),
 * Electron support, the WebP encoder for videos (a .wasm: screenshots are PNG), the Linux script that opens reports
 * (xdg-open), the command line and the type declarations stay out. Its package.json stays, cut to its name and
 * version (Playwright reads its version there, and it keeps the folder's .js files CommonJS under the plugin's
 * "type": "module"). test/plugin.test.ts takes a screenshot with what is left.
 */
const SHIPPED = (f: string) => !/^(bin|types|lib\/(vite|tools|entry|server\/electron))(\/|$)|^(cli\.js|README\.md|package\.json|lib\/xdg-open|lib\/webp_codec\..*)$|\.d\.ts$/.test(f);
const PLAYWRIGHT = 'server/playwright-core';

/** The script .mcp.json starts: plain sh, no variable but CLAUDE_PLUGIN_ROOT, which Claude Code and Cowork set. */
const START = `#!/bin/sh
# Starts TYKERF's MCP server with no folder open: Claude opens one with open_folder.
exec node "$CLAUDE_PLUGIN_ROOT/server/index.js" --lazy
`;

const json = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** playwright-core, trimmed (see SHIPPED), in server/playwright-core/, where the bundled server imports it. */
function shipPlaywright(out: string) {
  const from = join(root, 'node_modules', 'playwright-core');
  const to = join(out, PLAYWRIGHT);
  cpSync(from, to, { recursive: true, dereference: true, filter: (f) => statSync(f).isDirectory() || SHIPPED(relative(from, f).split(sep).join('/')) });
  dropEmpty(to);
  const { name, version, description, license, author, homepage, repository } = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
  json(join(to, 'package.json'), { name, version, description, license, author, homepage, repository });
  // the bundles' license notices, as text files
  for (const f of readdirSync(join(to, 'lib'))) if (f.endsWith('.LICENSE')) renameSync(join(to, 'lib', f), join(to, 'lib', `${f}.txt`));
}

/** Remove the folders the filter left empty (cpSync makes every folder before it knows whether a file goes in). */
function dropEmpty(dir: string): boolean {
  const left = readdirSync(dir).filter((f) => !statSync(join(dir, f)).isDirectory() || !dropEmpty(join(dir, f)));
  if (left.length) return false;
  rmSync(dir, { recursive: true });
  return true;
}

export async function buildPlugin(out = join(root, 'dist', 'plugin')): Promise<string> {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, '.claude-plugin'), { recursive: true });

  await bundleServer(out, { playwright: './playwright-core/index.mjs' });
  cpSync(join(root, 'plugin'), out, { recursive: true, filter: (f) => !f.endsWith('.DS_Store') });
  for (const f of ['LICENSE', 'NOTICE']) cpSync(join(root, f), join(out, f));
  cpSync(join(root, 'src', 'editor', 'public', 'brand', 'png', 'tykerf-app-icon-512.png'), join(out, 'icon.png'));

  json(join(out, '.claude-plugin', 'plugin.json'), {
    name: 'tykerf',
    displayName: 'TYKERF Community Edition',
    version,
    description: 'Build and edit real web pages block by block: Claude changes one named block at a time through validated moves, looks at the result, and every change can be undone. Plain HTML files in a folder, no platform.',
    author: { name: 'eonity.org', email: 'dev@eonity.org', url: 'https://eonity.org' },
    homepage: REPO,
    repository: REPO,
    license: 'Apache-2.0',
    keywords: ['web page', 'landing page', 'website', 'html', 'layout', 'editor'],
    icon: './icon.png',
    documentationUrl: `${REPO}/blob/main/docs/user-guide/README.md`,
    supportUrl: `${REPO}/issues`,
    privacyPolicyUrl: `${REPO}/blob/main/plugin/README.md#privacy-policy`,
  });
  // no setting: Claude Code flags an empty one as not set, and Cowork never asks; the default folder is TYKERF_DIR
  // (the environment, or a .env where Claude Code starts), else ~/TYKERF, the same in both
  json(join(out, '.mcp.json'), { mcpServers: { tykerf: { command: '${CLAUDE_PLUGIN_ROOT}/server/start.sh' } } });
  writeFileSync(join(out, 'server', 'start.sh'), START);
  chmodSync(join(out, 'server', 'start.sh'), 0o755);
  // the server is an ES module; no dependencies and no lockfile, so nothing is installed: Playwright is shipped
  json(join(out, 'package.json'), { name: 'tykerf-plugin', version, private: true, license: 'Apache-2.0', type: 'module' });
  shipPlaywright(out);
  if (!existsSync(join(out, 'README.md'))) throw new Error('plugin/README.md is missing: the directory shows it as the listing');
  return out;
}

/** The built plugin folder as one .zip next to it (dist/tykerf-plugin.zip), its files at the zip's root. */
export function packPlugin(dir: string, file = join(dirname(dir), 'tykerf-plugin.zip')): string {
  const paths = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => !statSync(join(dir, f)).isDirectory())
    .map((f) => f.split(sep).join('/'))
    .filter((f) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(f))
    .sort();
  // a file that runs (server/start.sh) keeps its permission to run
  writeFileSync(file, zip(paths.map((path) => ({ path, bytes: readFileSync(join(dir, path)), ...(statSync(join(dir, path)).mode & 0o111 ? { mode: 0o755 } : {}) }))));
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = await buildPlugin();
  console.log(`built ${dir}`);
  console.log(`built ${packPlugin(dir)}`);
}
