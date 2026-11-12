// Web files brought into a page or the site (src/files.ts): from a path or an address, checked by their bytes,
// named, deduplicated, undone; and the MCP tools that use them (add_file, add_files, set_content's file).

import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, addFile, fileKind, readSource } from '../src/files.js';
import { Site, newSitePage, pageWorkspace } from '../src/site.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const WOFF2 = new Uint8Array([...Buffer.from('wOF2'), 0, 1, 2, 3]);
const PDF = new Uint8Array(Buffer.from('%PDF-1.7\n…'));
const src = (bytes: Uint8Array, name: string, extra: Partial<{ type: string; local: boolean }> = {}) => ({ bytes, name, type: null, local: false, ...extra });

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/logo.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    if (req.url === '/site.css') return res.writeHead(200, { 'content-type': 'text/css' }).end('.a { color: red }');
    if (req.url === '/notes.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
    res.writeHead(404).end('no');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server?.close());

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-files-'));
  newSitePage(dir, 'home', 'blank', 'studio');
  return dir;
}

describe('a web file', () => {
  it('is read from a path on this computer only where that is allowed, and from an http(s) address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-src-'));
    writeFileSync(join(dir, 'logo.png'), PNG);
    await expect(readSource(join(dir, 'logo.png'), { localFiles: false })).rejects.toThrow(/a path on this computer can't be read here/);
    expect(await readSource(join(dir, 'logo.png'), { localFiles: true })).toMatchObject({ name: 'logo.png', local: true });
    await expect(readSource(dir, { localFiles: true })).rejects.toThrow(/is not a file this computer has/);
    await expect(readSource('ftp://example.com/x.png', { localFiles: true })).rejects.toThrow(/only http and https addresses/);
    expect(await readSource(`${base}/logo.png`, { localFiles: false })).toMatchObject({ name: 'logo.png', type: 'image/png', local: false });
    await expect(readSource(`${base}/gone.png`, { localFiles: false })).rejects.toThrow(/HTTP 404/);
    // too big: refused before it is read
    writeFileSync(join(dir, 'big.pdf'), Buffer.alloc(MAX_FILE_BYTES + 1));
    await expect(readSource(join(dir, 'big.pdf'), { localFiles: true })).rejects.toThrow(/larger than 25 MB/);
  });

  it('is known by its bytes; text only from this computer or when its server says what it is', async () => {
    expect(fileKind(src(PNG, 'x.bin'))).toEqual({ kind: 'image', ext: 'png' });
    expect(fileKind(src(WOFF2, 'f'))).toEqual({ kind: 'font', ext: 'woff2' });
    expect(fileKind(src(new Uint8Array([0, 1, 0, 0, 9, 9]), 'f'))).toEqual({ kind: 'font', ext: 'ttf' });
    expect(fileKind(src(PDF, 'doc'))).toEqual({ kind: 'pdf', ext: 'pdf' });
    expect(fileKind(src(new TextEncoder().encode('<svg viewBox="0 0 1 1"><rect/></svg>'), 'i.svg'))).toEqual({ kind: 'svg', ext: 'svg' });
    expect(() => fileKind(src(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), 'i.svg'))).toThrow(/scripts, event attributes/);
    const css = new TextEncoder().encode('.a { color: red }');
    expect(fileKind(src(css, 'a.css', { local: true }))).toEqual({ kind: 'css', ext: 'css' });
    expect(fileKind((await readSource(`${base}/site.css`, { localFiles: false })))).toEqual({ kind: 'css', ext: 'css' });
    expect(() => fileKind(src(css, 'a.css'))).toThrow(/is not a file TYKERF takes/); // from an address that didn't say
    expect(() => fileKind(src(new TextEncoder().encode('@import url(x.css);'), 'b.css', { local: true }))).toThrow(/no @import/);
    expect(fileKind(src(new TextEncoder().encode('export {}'), 'm.js', { local: true }))).toEqual({ kind: 'js', ext: 'js' });
    const text = await readSource(`${base}/notes.txt`, { localFiles: false });
    expect(() => fileKind(text)).toThrow(/is not a file TYKERF takes/);
  });

  it('is kept once under a free name, as a step undo takes back and redo brings back', () => {
    const dir = site();
    const home = pageWorkspace(dir, 'home');
    const a = addFile({ page: home }, src(PNG, 'Logo Big.PNG'), { from: 'test' });
    expect(a).toEqual({ file: 'logo-big.png', address: 'assets/logo-big.png', bytes: PNG.length, kind: 'image', deduped: false });
    // the same bytes again, under any name: the file that has them
    expect(addFile({ page: home }, src(PNG, 'other.png'), { from: 'test' })).toMatchObject({ file: 'logo-big.png', deduped: true });
    // the same name with other bytes: a hash keeps both
    const other = new Uint8Array([...PNG, 9]);
    expect(addFile({ page: home }, src(other, 'logo-big.png'), { from: 'test' }).file).toMatch(/^logo-big-[0-9a-f]{12}\.png$/);
    expect(home.history(1)[0]).toMatchObject({ kind: 'file', label: expect.stringMatching(/^add the file assets\/logo-big-/) });
    home.undo();
    home.undo();
    expect(existsSync(join(dir, 'home', 'assets', 'logo-big.png'))).toBe(false);
    home.redo();
    expect(new Uint8Array(readFileSync(join(dir, 'home', 'assets', 'logo-big.png')))).toEqual(PNG);
    // the bytes kept for redo go once nothing can redo them (a new change ends the redo list)
    home.undo();
    const trash = () => (existsSync(join(dir, 'home', '.tykerf', 'trash')) ? readdirSync(join(dir, 'home', '.tykerf', 'trash')) : []);
    expect(trash()).toHaveLength(2); // this one, and the one undone earlier and never redone
    home.setContent('text', '<p>a new change</p>', 'user');
    expect(trash()).toEqual([]);
    // the site's files: /assets/, a step of the site's history
    const s = addFile({ site: dir }, src(PDF, 'menu.pdf'), { from: 'test' });
    expect(s.address).toBe('/assets/menu.pdf');
    expect(new Site(dir).undo()).toBe('add the file /assets/menu.pdf');
    expect(existsSync(join(dir, 'assets', 'menu.pdf'))).toBe(false);
    new Site(dir).redo();
    expect(new Uint8Array(readFileSync(join(dir, 'assets', 'menu.pdf')))).toEqual(PDF);
  });
});

describe('the tools that add files', () => {
  it('add from paths only where the server may read them, say the address to write, and know what a turn added', async () => {
    const dir = site();
    const from = mkdtempSync(join(tmpdir(), 'tykerf-from-'));
    writeFileSync(join(from, 'logo.png'), PNG);
    writeFileSync(join(from, 'post.html'), '<article><h1>A long post</h1></article>');
    writeFileSync(join(from, 'lead.txt'), 'A new lead');
    const { createTykerfServer } = await import('../src/mcp/tools.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const connect = async (localFiles: boolean, home?: string) => {
      const server = createTykerfServer(pageWorkspace(dir, 'home'), { home: home ?? null, localFiles });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test', version: '0' });
      await Promise.all([server.connect(a), client.connect(b)]);
      const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text;
      return { call, close: () => client.close() };
    };

    const local = await connect(true);
    expect(await local.call('add_file', { from: join(from, 'logo.png') })).toBe('ok: added: assets/logo.png (image, 1 KB); write it as <img src="assets/logo.png" alt="…">');
    expect(await local.call('add_files', { items: [{ from: `${base}/logo.png`, to: 'site' }, { from: join(from, 'nope.png') }] }))
      .toMatch(/^ok: added: \/assets\/logo\.png \(image, 1 KB\); write it as <img src="\/assets\/logo\.png" alt="…">\nerror: .*nope\.png: .* is not a file this computer has$/);
    // a box that names the site's file as the page's: the reply says which address to write
    const said = await local.call('set_content', { id: 'text', html: '<img src="assets/logo2.png" alt="">' });
    expect(said).toMatch(/assets\/logo2\.png is not among the page's files/);
    writeFileSync(join(from, 'menu.pdf'), PDF);
    await local.call('add_file', { from: join(from, 'menu.pdf'), to: 'site' });
    expect(await local.call('set_content', { id: 'text', html: '<a href="assets/menu.pdf">Menu</a>' }))
      .toMatch(/\nwarning: assets\/menu\.pdf was added as \/assets\/menu\.pdf: write that$/);
    // long code from a file, which needn't pass through the model
    expect(await local.call('set_content', { id: 'text', file: join(from, 'post.html') })).toMatch(/^ok: content of "text" set from .*post\.html \(39 bytes\)/);
    expect(pageWorkspace(dir, 'home').content('text')).toContain('A long post');
    expect(await local.call('edit_content', { id: 'text', old: 'A long post', new_file: join(from, 'lead.txt') })).toMatch(/^ok: 1 change in "text" \(the new text from .*lead\.txt, 10 bytes\)/);
    await local.close();

    // the editor's runs: addresses and attached files only, no paths, no code from files
    const hosted = await connect(false);
    expect(await hosted.call('add_file', { from: join(from, 'logo.png') })).toMatch(/a path on this computer can't be read here/);
    expect(await hosted.call('set_content', { id: 'text', file: join(from, 'post.html') })).toMatch(/give either html or file/);
    expect(await hosted.call('add_file', { from: `${base}/logo.png` })).toMatch(/^ok: already there: assets\/logo\.png/);
    await hosted.close();

    // on a run over the site, a file goes to the site by default
    const whole = await connect(true, dir);
    writeFileSync(join(from, 'list.pdf'), new Uint8Array([...PDF, 7]));
    expect(await whole.call('add_file', { from: join(from, 'list.pdf') })).toMatch(/^ok: added: \/assets\/list\.pdf \(pdf, 1 KB\); write it as <a href="\/assets\/list\.pdf">/);
    await whole.close();
  });
});
