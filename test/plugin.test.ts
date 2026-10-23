// The Claude plugin: a folder that passes the directory's file rules, whose bundled server starts on its own (no tsx,
// no repository) with no folder open, and edits the folder Claude opens.

import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildPlugin } from '../scripts/build-plugin.js';
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
    expect(manifest.userConfig.page_folder).toMatchObject({ type: 'directory', default: '' });
    expect(read(out, '.mcp.json').mcpServers.tykerf).toEqual({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/index.js', '--lazy', '--dir', '${user_config.page_folder}'] });
    const readme = readFileSync(join(out, 'README.md'), 'utf8');
    expect(readme.replace(/```[\s\S]*?```/g, '').split(/\s+/).length).toBeGreaterThan(40);
    for (const part of ['data collection', 'stored', 'third parties', 'Retention', 'Contact']) expect(readme.toLowerCase()).toContain(part.toLowerCase().split(' ')[0]);
  });

  it('has a skill that names only tools the server has', async () => {
    const skill = readFileSync(join(out, 'skills', 'tykerf', 'SKILL.md'), 'utf8');
    const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
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
    expect(all.filter((f) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(f) || f.startsWith('bin/'))).toEqual([]);
    expect(all.filter((f) => lstatSync(join(out, f)).isSymbolicLink())).toEqual([]);
    // under 5 MiB each; only the bundled server is over 256 KiB (a reviewer reads it), and it is not minified
    expect(all.filter((f) => lstatSync(join(out, f)).size > 5 * 1024 * 1024)).toEqual([]);
    expect(all.filter((f) => lstatSync(join(out, f)).size > 256 * 1024 && !/\.(png|woff2)$/.test(f))).toEqual(['server/index.js']);
    expect(readFileSync(join(out, 'server/index.js'), 'utf8').split('\n').length).toBeGreaterThan(10_000);
  });

  it('installs exactly the Playwright the repository uses, from registry packages only', () => {
    const pkg = read(out, 'package.json'), lock = read(out, 'package-lock.json');
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
    expect(pkg.dependencies.playwright).toBe(read('.', 'package-lock.json').packages['node_modules/playwright'].version);
    for (const [k, v] of Object.entries(lock.packages).filter(([k]) => k)) expect(v, k).toMatchObject({ resolved: expect.stringMatching(/^https:\/\/registry\.npmjs\.org\//), integrity: expect.stringMatching(/^sha512-/) });
  });

  it('starts with no folder open, and edits the folder Claude opens', async () => {
    const page = mkdtempSync(join(tmpdir(), 'tykerf-plugin-page-'));
    cpSync('examples/widgets', page, { recursive: true, filter: (f) => !/\/(out|\.tykerf)(\/|$)|history/.test(relative(process.cwd(), f)) });
    // as Claude Code starts it: from another folder, with the setting filled in
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, 'server', 'index.js'), '--lazy', '--dir', page], cwd: tmpdir(), env: { ...getDefaultEnvironment(), TYKERF_DOTENV: 'off' }, stderr: 'pipe' }));
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
    } finally {
      await client.close();
    }
  });
});
