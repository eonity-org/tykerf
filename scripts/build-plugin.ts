// Build the Claude plugin for Anthropic's directory: TYKERF's MCP server as one readable bundled file (shared with
// the extension), the page library, the plugin manifest and MCP config, and Playwright as the one package that
// Claude Code installs from the lockfile. The README, the skills and the license come from plugin/ and the root.
//
//   npm run build:plugin               -> dist/plugin/ (the plugin folder, at its root)
//
// The server starts with no folder open (--lazy): Cowork can't ask for one on install, so Claude opens one with
// open_folder, the default when the person names none. Plan and checks: docs/plans/claude-plugin.md.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleServer } from './build-mcpb.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/eonity-org/tykerf';
/** The packages the plugin installs: the bundle leaves them out (see bundleServer). */
const PACKAGES = ['playwright', 'playwright-core'];

const json = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/**
 * The plugin's package.json and package-lock.json, taken from the repository's own lockfile, so the plugin installs
 * exactly the Playwright the tests ran with. Claude Code installs only exact registry versions, with no scripts.
 */
function packages(version: string) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entries = Object.fromEntries(PACKAGES.map((p) => [`node_modules/${p}`, lock.packages[`node_modules/${p}`]]));
  const dependencies = { playwright: entries['node_modules/playwright'].version as string };
  const pkg = { name: 'tykerf-plugin', version, private: true, license: 'Apache-2.0', type: 'module', dependencies };
  return {
    pkg,
    lock: { name: pkg.name, version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version, license: pkg.license, dependencies }, ...entries } },
  };
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
  const { pkg, lock } = packages(version);
  json(join(out, 'package.json'), pkg);
  json(join(out, 'package-lock.json'), lock);
  if (!existsSync(join(out, 'README.md'))) throw new Error('plugin/README.md is missing: the directory shows it as the listing');
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(`built ${await buildPlugin()}`);
}
