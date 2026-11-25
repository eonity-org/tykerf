// The Claude plugin: a folder that passes the directory's file rules, whose bundled server starts on its own (no tsx,
// no repository, no install) from its start script with no folder open, edits the folder Claude opens, and takes
// screenshots with the Playwright it ships.

import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildPlugin, packPlugin } from '../scripts/build-plugin.js';
import { unzip } from '../src/unzip.js';
import { createTykerfServer } from '../src/mcp/tools.js';

vi.setConfig({ testTimeout: 60_000 });

const files = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => !lstatSync(join(dir, f)).isDirectory());
const read = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('the Claude plugin', async () => {
  const out = await buildPlugin(join(mkdtempSync(join(tmpdir(), 'tykerf-plugin-')), 'plugin'));

  it('has the manifest, the MCP config and the README the directory reads', () => {
    const manifest = read(out, '.claude-plugin/plugin.json');
    expect(manifest).toMatchObject({ name: 'tykerf', version: read('.', 'package.json').version, license: 'Apache-2.0', author: { name: 'eonity.org', email: 'dev@eonity.org' }, icon: './icon.png' });
    expect(manifest.privacyPolicyUrl).toMatch(/^https:\/\/.*plugin\/README\.md#privacy-policy$/);
    // Cowork leaves out a server whose setting has no default
    // no setting to fill in (Claude Code flags an empty one, Cowork never asks): the default folder is TYKERF_DIR, else ~/TYKERF
    expect(manifest.userConfig).toBeUndefined();
    // the directory's rule for a local server: a plain shell script at a literal path, no variable but CLAUDE_PLUGIN_ROOT
    expect(read(out, '.mcp.json').mcpServers.tykerf).toEqual({ command: '${CLAUDE_PLUGIN_ROOT}/server/start.sh' });
    const start = readFileSync(join(out, 'server/start.sh'), 'utf8');
    expect(start).toMatch(/^#!\/bin\/sh\n/);
    expect([...start.replace(/^#.*$/gm, '').matchAll(/\$\{?(\w+|[@*#?!$0-9-])/g)].map((m) => m[1])).toEqual(['CLAUDE_PLUGIN_ROOT']);
    expect(start).not.toMatch(/`|\$\(|[*?~]|<<|\{|npx|uvx|pipx|bun|npm/);
    expect(statSync(join(out, 'server/start.sh')).mode & 0o111).toBe(0o111);
    const readme = readFileSync(join(out, 'README.md'), 'utf8');
    expect(readme.replace(/```[\s\S]*?```/g, '').split(/\s+/).length).toBeGreaterThan(40);
    for (const part of ['data collection', 'stored', 'third parties', 'Retention', 'Contact']) expect(readme.toLowerCase()).toContain(part.toLowerCase().split(' ')[0]);
  });

  it('is listed in the repository\'s own marketplace, at the branch each release writes it to', () => {
    // people add eonity-org/tykerf as a marketplace (the default branch), and install tykerf@eonity.org from it
    const market = read('.', '.claude-plugin/marketplace.json');
    expect(market.name).toBe('eonity.org'); // the publisher's name, as in plugin.json's author
    const entry = market.plugins.find((p: { name: string }) => p.name === read(out, '.claude-plugin/plugin.json').name);
    expect(entry?.source).toEqual({ source: 'github', repo: 'eonity-org/tykerf', ref: 'claude-plugin' });
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain(`git push origin ${entry.source.ref}`);
    expect(entry.version).toBeUndefined(); // plugin.json's version decides, raised with every release
  });

  it('has a skill that names only tools the server has', async () => {
    const skill = readFileSync(join(out, 'skills', 'tykerf', 'SKILL.md'), 'utf8');
    // the description in double quotes: it holds ": ", which YAML would read as a key otherwise
    const front = /^---\nname: (.+)\ndescription: "([^"\\]+)"\n---\n/.exec(skill);
    expect(front?.[1]).toBe('tykerf'); // the folder's name
    expect(front?.[2]).toMatch(/^Build or change a web page.*Not for pages inside an application's codebase/);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([createTykerfServer(null, { folders: { defaultDir: tmpdir() } }).connect(a), client.connect(b)]);
    const tools = new Set((await client.listTools()).tools.map((t) => t.name));
    await client.close();
    const named = [...skill.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(15);
    expect(named.filter((n) => !tools.has(n))).toEqual([]);
  });

  it('keeps to the directory\'s file rules', () => {
    const all = files(out);
    expect(all.length).toBeLessThan(512);
    expect(all.filter((f) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(f) || f.startsWith('bin/') || /(^|\/)node_modules\//.test(f))).toEqual([]);
    expect(all.filter((f) => lstatSync(join(out, f)).isSymbolicLink())).toEqual([]);
    // under 5 MiB each; only the bundled server (not minified) and Playwright's two bundles are over 256 KiB: a reviewer reads them
    expect(all.filter((f) => lstatSync(join(out, f)).size > 5 * 1024 * 1024)).toEqual([]);
    expect(all.filter((f) => lstatSync(join(out, f)).size > 256 * 1024 && !/\.(png|woff2)$/.test(f)).sort()).toEqual(['server/index.js', 'server/playwright-core/lib/coreBundle.js', 'server/playwright-core/lib/utilsBundle.js']);
    // only text, pictures and fonts: no binaries, one script for a shell (the server's start), no skills other than the plugin's own
    expect(all.filter((f) => !/\.(js|mjs|json|md|txt|html|svg|png|woff2)$|(^|\/)(LICENSE|NOTICE)$/.test(f))).toEqual(['server/start.sh']);
    // every package.json a plain object of the fields the directory lists
    const allowed = new Set(['name', 'displayName', 'version', 'description', 'keywords', 'homepage', 'bugs', 'license', 'author', 'contributors', 'maintainers', 'funding', 'repository', 'private', 'type', 'files', 'engines', '$schema']);
    for (const f of all.filter((f) => f.endsWith('package.json'))) expect(Object.keys(read(out, f)).filter((k) => !allowed.has(k)), f).toEqual([]);
    expect(all.filter((f) => f.endsWith('SKILL.md'))).toEqual(['skills/tykerf/SKILL.md']);
    expect(readFileSync(join(out, 'server/index.js'), 'utf8').split('\n').length).toBeGreaterThan(10_000);
  });

  it('packs into one .zip for Claude Desktop\'s upload, the same files at its root', () => {
    const file = packPlugin(out);
    expect(file).toBe(join(out, '..', 'tykerf-plugin.zip'));
    const { files: packed, skipped } = unzip(readFileSync(file), { maxFiles: 1000, maxTotal: 100 * 1024 * 1024 });
    expect(skipped).toEqual([]);
    expect(packed.map((f) => f.path).sort()).toEqual(files(out).sort());
    // the start script keeps its permission to run (Unix, in the central directory's external attributes)
    const zipped = Buffer.from(readFileSync(file));
    const modes: Record<string, number> = {};
    // the central directory: where the end record (the last 22 bytes) says, one 46-byte entry and its name per file
    for (let at = zipped.readUInt32LE(zipped.length - 22 + 16); zipped.readUInt32LE(at) === 0x02014b50; ) {
      const n = zipped.readUInt16LE(at + 28);
      modes[zipped.subarray(at + 46, at + 46 + n).toString('utf8')] = (zipped.readUInt32LE(at + 38) >>> 16) & 0o777;
      at += 46 + n + zipped.readUInt16LE(at + 30) + zipped.readUInt16LE(at + 32);
    }
    expect(modes['server/start.sh']).toBe(0o755);
    expect(modes['server/index.js']).toBe(0); // the rest as before: the unzipping program decides
    expect(JSON.parse(Buffer.from(packed.find((f) => f.path === '.claude-plugin/plugin.json')!.bytes).toString('utf8'))).toEqual(read(out, '.claude-plugin/plugin.json'));
  });

  it('ships the Playwright the repository uses, trimmed to what screenshots need, as its own files, and installs nothing', () => {
    // Cowork doesn't install a plugin's packages, so Playwright comes along; no lockfile, so Claude Code installs nothing either
    expect(read(out, 'package.json')).toEqual({ name: 'tykerf-plugin', version: read('.', 'package.json').version, private: true, license: 'Apache-2.0', type: 'module' });
    expect(existsSync(join(out, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(out, 'node_modules'))).toBe(false);
    const core = 'server/playwright-core';
    expect(read(out, `${core}/package.json`).version).toBe(read('.', 'package-lock.json').packages['node_modules/playwright-core'].version);
    expect(read(out, `${core}/package.json`).type).toBeUndefined(); // its .js files stay CommonJS
    for (const f of ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt']) expect(existsSync(join(out, core, f)), f).toBe(true);
    expect(files(join(out, core)).filter((f) => /^(bin|types|lib\/(vite|tools|entry))\/|xdg-open|webp_codec|\.d\.ts$/.test(f))).toEqual([]);
    // the bundled server imports it by its path, not by a package name
    const server = readFileSync(join(out, 'server/index.js'), 'utf8');
    expect(server).toContain('import("./playwright-core/index.mjs")');
    expect(server).not.toMatch(/(from|import\()\s*["']playwright(-core)?["']/);
  });

  it('starts with no folder open, and edits the folder Claude opens', async () => {
    const page = mkdtempSync(join(tmpdir(), 'tykerf-plugin-page-'));
    cpSync('examples/widgets', page, { recursive: true, filter: (f) => !/\/(out|\.tykerf)(\/|$)|history/.test(relative(process.cwd(), f)) });
    // as Claude Code starts it: its start script, from another folder, with CLAUDE_PLUGIN_ROOT set and node on the PATH
    const client = new Client({ name: 'test', version: '0' });
    const env = { ...getDefaultEnvironment(), CLAUDE_PLUGIN_ROOT: out, TYKERF_DIR: page, TYKERF_DOTENV: 'off', PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
    await client.connect(new StdioClientTransport({ command: join(out, 'server', 'start.sh'), cwd: tmpdir(), env, stderr: 'pipe' }));
    const call = async (name: string, a: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: a })) as { content: { text?: string }[]; isError?: boolean };
      return { text: r.content.map((x) => x.text ?? '').join('\n'), error: !!r.isError };
    };
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain('open_folder');
      expect(await call('get_layout')).toMatchObject({ error: true, text: expect.stringContaining(`the default folder, ${page}`) });
      expect((await call('list_components')).text).toMatch(/hero/); // the library came along
      expect((await call('open_folder')).text).toMatch(new RegExp(`^ok: ${page} is open, a page`));
      expect(await call('set_content', { id: 'title', html: '<h1>from the plugin</h1>' })).toMatchObject({ error: false });
      expect(readFileSync(join(page, 'boxes', 'title.html'), 'utf8')).toContain('from the plugin');
      // the shipped Playwright takes pictures and measures the page
      const shot = (await client.callTool({ name: 'screenshot', arguments: { width: 375 } })) as { content: { type: string }[]; isError?: boolean };
      expect(shot.isError).toBeFalsy();
      expect(shot.content.map((c) => c.type)).toEqual(['image', 'text']);
      expect(await call('evaluate', { widths: [375] })).toMatchObject({ error: false });
    } finally {
      await client.close();
    }
  });
});
