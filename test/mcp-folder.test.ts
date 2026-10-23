import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type TykerfServerOptions, createTykerfServer, folderPath } from '../src/mcp/tools.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const temp = () => mkdtempSync(join(tmpdir(), 'tykerf-folder-'));

async function client(transport: Parameters<Client['connect']>[0]) {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(transport);
  clients.push(c);
  const call = async (name: string, a: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: a })) as { content: { text?: string }[]; isError?: boolean };
    return { text: r.content.map((x) => x.text ?? '').join('\n'), error: !!r.isError };
  };
  return { call, names: async () => (await c.listTools()).tools.map((t) => t.name) };
}

/** A server in this process, as createTykerfServer makes it. */
async function inProcess(start: Workspace | null, opts: TykerfServerOptions) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createTykerfServer(start, opts).connect(a);
  return client(b);
}

/** The stdio server, as the plugin starts it. */
const stdio = (args: string[], env: Record<string, string> = {}) =>
  client(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/server.ts', ...args], env: { ...getDefaultEnvironment(), TYKERF_DOTENV: 'off', ...env }, stderr: 'ignore' }));

describe('a server with no folder open (the Claude plugin)', () => {
  it('answers only open_folder and the library lists, and names the default folder', async () => {
    const dir = join(temp(), 'mine');
    const { call, names } = await inProcess(null, { folders: { defaultDir: dir } });
    expect(await names()).toEqual(expect.arrayContaining(['open_folder', 'list_pages', 'new_page']));
    expect(await call('get_layout')).toEqual({ error: true, text: expect.stringContaining(`no folder is open. open_folder opens one (without a path: the default folder, ${dir})`) });
    expect(await call('use_layout', { name: 'blank' })).toMatchObject({ error: true });
    expect(await call('list_layouts')).toMatchObject({ error: false, text: expect.stringContaining('blank:') });
    expect(existsSync(dir)).toBe(false);
  });

  it('opens the default folder without a path, and a new folder gets its page when something is written', async () => {
    const dir = join(temp(), 'mine');
    const { call } = await inProcess(null, { folders: { defaultDir: dir } });
    expect(await call('open_folder')).toEqual({ error: false, text: expect.stringMatching(new RegExp(`^ok: ${dir} is open, a new folder \\(made when something is written\\): use_layout starts a page here`)) });
    expect(existsSync(dir)).toBe(false);
    expect(await call('use_layout', { name: 'blank' })).toMatchObject({ error: false });
    expect(existsSync(join(dir, 'layout.slice'))).toBe(true);
  });

  it('opens a page or a site, and refuses a folder of other files, keeping the folder that was open', async () => {
    const page = join(temp(), 'widgets');
    cpSync('examples/widgets', page, { recursive: true });
    const other = temp();
    writeFileSync(join(other, 'notes.txt'), 'not a page');
    const site = temp();
    cpSync('examples/widgets', join(site, 'rome'), { recursive: true });
    mkdirSync(join(site, 'empty-folder'));

    const { call } = await inProcess(null, { folders: { defaultDir: temp() } });
    // a folder of its own, so it reads as a site of one page
    expect((await call('open_folder', { path: ` ${page} ` })).text).toMatch(new RegExp(`^ok: ${page} is open, a page of the site ${dirname(page)}\\n\\npage column`));
    expect(await call('open_folder', { path: other })).toEqual({ error: true, text: expect.stringContaining('holds other files and no pages') });
    expect((await call('get_layout')).text).toMatch(/^page column/);

    expect((await call('open_folder', { path: site })).text).toBe(`ok: ${site} is open, a site of 1 page: rome. open_page opens one, new_page makes another.`);
    expect((await call('list_pages')).text).toMatch(/^site .*\nrome\nno page is open/);
    expect(await call('open_page', { name: 'rome' })).toMatchObject({ error: false });
    expect((await call('open_folder', { path: join(site, 'rome') })).text).toMatch(new RegExp(`^ok: ${join(site, 'rome')} is open, a page of the site ${site}`));
  });

  it('is offered only where folders may be opened: not to the extension, the editor or a run on one block', async () => {
    const ws = new Workspace(new MemoryStore('memory:folder'));
    expect(await (await inProcess(ws, { home: process.cwd() })).names()).not.toContain('open_folder');
    expect(await (await inProcess(null, { folders: { defaultDir: temp() }, scope: 'nav' })).names()).not.toContain('open_folder');
  });
});

describe('a folder as a person writes it', () => {
  it('starts at the home folder with ~, and loses the spaces a paste brings', () => {
    expect(folderPath('~/Sites/rome')).toBe(join(homedir(), 'Sites/rome'));
    expect(folderPath('~')).toBe(homedir());
    expect(folderPath('  /tmp/rome  ')).toBe('/tmp/rome');
  });
});

describe('the default folder of server.ts --lazy', () => {
  it('is --dir, else TYKERF_DIR, else ~/TYKERF, and nothing is open until open_folder', async () => {
    const given = join(temp(), 'given'), env = join(temp(), 'env');
    const withDir = await stdio(['--lazy', '--dir', given], { TYKERF_DIR: env });
    expect((await withDir.call('get_layout')).text).toContain(`the default folder, ${given})`);
    expect((await withDir.call('open_folder')).text).toMatch(new RegExp(`^ok: ${given} is open`));

    // a client's setting left empty arrives as "" or unfilled (the extension's page_folder, say)
    for (const dir of ['', '${user_config.page_folder}']) expect((await (await stdio(['--lazy', '--dir', dir], { TYKERF_DIR: env })).call('get_layout')).text).toContain(`the default folder, ${env})`);
    expect((await (await stdio(['--lazy'])).call('get_layout')).text).toContain(`the default folder, ${join(homedir(), 'TYKERF')})`);
  });
});
