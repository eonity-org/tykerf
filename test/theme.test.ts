import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store.js';
import { createPage, readTheme, setTheme, themeValueError } from '../src/library.js';
import { Workspace } from '../src/workspace.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function landing(): Workspace {
  const ws = new Workspace(new MemoryStore('memory:theme'));
  createPage(ws, 'launch');
  return ws;
}

describe('theme values', () => {
  it('accepts colours, fonts and lengths of the right kind', () => {
    for (const [n, v] of [
      ['--color-accent', '#c2185b'], ['--color-accent', 'rebeccapurple'], ['--color-bg', 'oklch(0.97 0.02 340)'],
      ['--color-surface', 'color-mix(in srgb, var(--color-bg) 94%, var(--color-text))'], ['--color-text', 'rgb(20 20 20 / 90%)'],
      ['--font-heading', 'Georgia, "Times New Roman", serif'], ['--font-body', 'system-ui, sans-serif'],
      ['--radius', '0'], ['--radius', '1.5rem'], ['--gap', 'clamp(16px, 2vw, 32px)'], ['--max-width', '1200px'],
    ]) expect(themeValueError(n, v), `${n}: ${v}`).toBeNull();
  });

  it('refuses anything that could escape the declaration or load from another server', () => {
    for (const [n, v] of [
      ['--color-accent', 'red; } body { display: none'], ['--color-accent', 'url(https://evil.example/x)'],
      ['--font-body', 'x, url(https://fonts.example/f.woff2)'], ['--font-body', '@import "x"'], ['--color-bg', '</style><script>'],
      ['--radius', '12px /* */'], ['--color-accent', ''],
    ]) expect(themeValueError(n, v), `${n}: ${v}`).toMatch(/not allowed|characters/);
  });

  it('refuses values of the wrong kind', () => {
    expect(themeValueError('--color-accent', '12px')).toMatch(/not a colour/);
    expect(themeValueError('--color-accent', '#12')).toMatch(/not a colour/);
    expect(themeValueError('--radius', 'big')).toMatch(/not a length/);
    expect(themeValueError('--font-heading', '12px')).toMatch(/not a list of font names/);
  });
});

describe('setTheme', () => {
  it('changes only the given variables, keeps the rest of the head, and is one undo step', () => {
    const ws = landing();
    const before = ws.head();
    const changed = setTheme(ws, { '--color-accent': '#c2185b', '--radius': '4px' });
    expect(changed).toEqual({ '--color-accent': { from: '#1a52dd', to: '#c2185b' }, '--radius': { from: '18px', to: '4px' } });
    expect(readTheme(ws.head())).toMatchObject({ '--color-accent': '#c2185b', '--radius': '4px', '--color-bg': '#fafaf8' });
    expect(ws.head().replace('#c2185b', '#1a52dd').replace('--radius: 4px', '--radius: 18px')).toBe(before);
    expect(ws.history(1)[0]).toMatchObject({ label: 'theme: --color-accent #c2185b, --radius 4px', author: 'ai', kind: 'head' });
    ws.undo();
    expect(ws.head()).toBe(before);
  });

  it('refuses unknown variables, bad values and pages without a theme, changing nothing', () => {
    const ws = landing();
    const before = ws.head();
    expect(() => setTheme(ws, { '--color-new': '#fff' })).toThrow(/unknown theme variables: --color-new/);
    expect(() => setTheme(ws, { '--color-accent': '#c2185b', '--radius': 'url(x)' })).toThrow(/not allowed/);
    expect(ws.head()).toBe(before);
    expect(ws.history()).toEqual([]);
    const plain = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'a b H\n' }));
    expect(() => setTheme(plain, { '--color-accent': '#fff' })).toThrow(/no theme/);
  });

  it('logs nothing when the values are already set', () => {
    const ws = landing();
    expect(setTheme(ws, { '--color-accent': '#1a52dd' })).toEqual({});
    expect(ws.history()).toEqual([]);
  });
});

describe('the AI and the theme (MCP server)', () => {
  let dir: string;
  let client: Client;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join('\n'), error: !!r.isError };
  };
  const scope = (id: string | null) => (id ? writeFileSync(join(dir, '.scope'), `${id} user\n`) : writeFileSync(join(dir, '.scope'), ''));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tykerf-theme-'));
    createPage(new Workspace(dir), 'launch');
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'src/mcp/server.ts'), '--dir', dir], stderr: 'ignore' }));
  }, 30000);
  afterAll(async () => { await client?.close(); });

  it('reads the theme', async () => {
    expect((await call('get_theme')).text).toContain('--color-accent: #1a52dd');
  });

  it('changes it when the scope is the whole page', async () => {
    scope('page');
    const r = await call('set_theme', { changes: [{ name: '--color-accent', value: '#c2185b' }] });
    expect(r).toEqual({ text: 'theme changed:\n--color-accent: #1a52dd -> #c2185b', error: false });
    expect(readTheme(new Workspace(dir).head())['--color-accent']).toBe('#c2185b');
  });

  it('takes the names as models write them: with quotes, spaces or no dashes; and says which exist when one does not', async () => {
    scope('page');
    const r = await call('set_theme', { changes: [{ name: '"--color-accent"', value: '#b0306a' }, { name: ' color_text ', value: '#101010' }, { name: 'var(--color-band)', value: '#eeeeee' }] }); // as Gemini sent them
    expect(r).toMatchObject({ error: false, text: expect.stringContaining('--color-accent: #c2185b -> #b0306a') });
    expect(r.text).toContain('--color-text:');
    expect(r.text).toContain('--color-band:');
    const bad = await call('set_theme', { changes: [{ name: 'varname_53', value: '' }] });
    expect(bad).toMatchObject({ error: true, text: expect.stringMatching(/unknown theme variables: --varname-53 \(the theme has --color-bg, .*--color-accent/) });
    expect((await call('set_theme', { changes: [] })).error).toBe(true);
    await call('undo'); // as the next tests expect it
  });

  it('refuses it from a smaller block, and refuses undoing it from there', async () => {
    scope('hero');
    const r = await call('set_theme', { changes: [{ name: '--color-accent', value: '#000000' }] });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/scope is "hero".*select the page block/);
    expect((await call('undo')).text).toMatch(/refused: undoing "theme: --color-accent #c2185b" would change the page head/);
    expect(readTheme(new Workspace(dir).head())['--color-accent']).toBe('#c2185b');
  });

  it('can undo it from the page scope', async () => {
    scope('page');
    expect((await call('undo')).text).toBe('undid: theme: --color-accent #c2185b');
    expect(readTheme(new Workspace(dir).head())['--color-accent']).toBe('#1a52dd');
  });
});
