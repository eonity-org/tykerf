// Build the Claude plugin for Anthropic's directory: TYKERF's MCP server as one readable bundled file (shared with
// the extension), the page library, the plugin manifest and MCP config, and the part of Playwright that screenshots
// need. The README, the skills and the license come from plugin/ and the root.
//
//   npm run build:plugin               -> dist/plugin/ (the plugin folder, at its root)
//
// The server starts with no folder open (--lazy): Cowork can't ask for one on install, so Claude opens one with
// open_folder, the default when the person names none. Plan and checks: docs/plans/claude-plugin.md.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleServer } from './build-mcpb.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/eonity-org/tykerf';
/**
 * Playwright goes in the plugin: Cowork runs what a plugin ships but doesn't install its packages, so screenshots
 * need it inside (Claude Code then uses the same files). Only what launching Chromium needs, with the licenses:
 * `playwright` only re-exports `playwright-core`, and of that the browser-install scripts (bin/), the trace viewer,
 * recorder and report apps (lib/vite/), the command line's tools and skills (lib/tools/), the entry points for the
 * browser download, daemon, dashboard and MCP server (lib/entry/), Electron support, the WebP encoder for videos
 * (a .wasm: screenshots are PNG), the Linux script that opens reports (xdg-open), the command line and the type
 * declarations stay out. test/plugin.test.ts takes a screenshot with what is left.
 */
const SHIPPED: Record<string, (path: string) => boolean> = {
  playwright: (f) => /^(package\.json|index\.m?js|LICENSE|NOTICE|ThirdPartyNotices\.txt)$/.test(f),
  'playwright-core': (f) => !/^(bin|types|lib\/(vite|tools|entry|server\/electron))(\/|$)|^(cli\.js|README\.md|lib\/xdg-open|lib\/webp_codec\..*)$|\.d\.ts$/.test(f),
};

const json = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Playwright's packages, trimmed (see SHIPPED), in the plugin's node_modules, where the bundled server finds them. */
function shipPlaywright(out: string) {
  for (const [name, keep] of Object.entries(SHIPPED)) {
    const from = join(root, 'node_modules', name);
    const to = join(out, 'node_modules', name);
    cpSync(from, to, { recursive: true, dereference: true, filter: (f) => statSync(f).isDirectory() || keep(relative(from, f).split(sep).join('/')) });
    dropEmpty(to);
  }
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

  await bundleServer(out);
  cpSync(join(root, 'plugin'), out, { recursive: true, filter: (f) => !f.endsWith('.DS_Store') });
  for (const f of ['LICENSE', 'NOTICE']) cpSync(join(root, f), join(out, f));
  cpSync(join(root, 'src', 'editor', 'public', 'brand', 'png', 'tykerf-app-icon-512.png'), join(out, 'icon.png'));

  json(join(out, '.claude-plugin', 'plugin.json'), {
    name: 'tykerf',
    displayName: 'TYKERF',
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
    userConfig: {
      // Cowork doesn't ask and leaves out a server whose setting has no default: empty means TYKERF_DIR, else ~/TYKERF
      page_folder: {
        type: 'directory',
        title: 'Default page folder',
        description: 'The folder Claude opens when you name none: a TYKERF page, a site of pages, or an empty folder to start in. Leave it empty for ~/TYKERF.',
        default: '',
      },
    },
  });
  json(join(out, '.mcp.json'), {
    mcpServers: { tykerf: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/index.js', '--lazy', '--dir', '${user_config.page_folder}'] } },
  });
  // the server is an ES module; no dependencies and no lockfile, so nothing is installed: Playwright is shipped
  json(join(out, 'package.json'), { name: 'tykerf-plugin', version, private: true, license: 'Apache-2.0', type: 'module' });
  shipPlaywright(out);
  if (!existsSync(join(out, 'README.md'))) throw new Error('plugin/README.md is missing: the directory shows it as the listing');
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(`built ${await buildPlugin()}`);
}
