// A new page in the v3 editor (shell/screens.js, the New page screen): Kaity builds it from words while the bar and
// the tray show her steps (the page's job), or it starts from a layout; the name is checked first. The editor runs
// the Anthropic runner against a fake API.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newSitePage } from '../src/site.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 45_000 });

const message = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

describe('a new page in the v3 editor', () => {
  let api: Server;
  let browser: Browser;
  let server: ChildProcess;
  let site: string;
  let base: string;
  let page: Page;

  beforeAll(async () => {
    // Kaity looks at the page once (slowly, so her work can be seen), then says she built it
    api = createServer(async (req, res) => {
      let s = '';
      for await (const c of req) s += c;
      const body = JSON.parse(s);
      const turn = body.messages.filter((m: { role: string }) => m.role === 'assistant').length;
      if (turn === 0) await new Promise((ok) => setTimeout(ok, 1500));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(turn === 0
        ? message([{ type: 'tool_use', id: 'g', name: 'get_layout', input: {} }])
        : message([{ type: 'text', text: 'I built a page for the bakery.' }], 'end_turn')));
    });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
    site = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-new-')), 'site');
    newSitePage(site, 'first', 'launch', 'studio');
    const port = await freePort();
    base = `http://localhost:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_DOTENV: 'off', TYKERF_TASK_SHOTS: 'off', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` },
    });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    api?.close();
  });

  it('opens from + Page in the sidebar, as a screen of its own, with the way back', async () => {
    await page.goto(`${base}/_tykerf/edit/first/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar [data-screen="new"]').click();
    await page.locator('.screen h1', { hasText: 'What page do you want?' }).waitFor();
    expect(await page.locator('.sidebar').isHidden()).toBe(true);
    expect(await page.locator('.bar a', { hasText: 'Cancel and go back to first' }).getAttribute('href')).toBe('/_tykerf/edit/first/');
    expect(await page.locator('#np-name').inputValue()).toBe('page-2');
    expect(await page.locator('.np-name .note').textContent()).toMatch(/^Its address will be \/page-2\/\. /);
    // a name the site has is refused, and so is a request with nothing in it
    await page.locator('#np-name').fill('first');
    await page.locator('.np-kaity [type="submit"]').click();
    expect(await page.locator('.np-error').textContent()).toBe('There is already a page called first.');
    await page.locator('#np-name').fill('bakery');
    await page.locator('.np-kaity [type="submit"]').click();
    expect(await page.locator('.np-error').textContent()).toBe('Write what the page should be, or add an image of it.');
  });

  it('has Kaity build it: the page opens at once, the bar and the tray show her at work, then that it is ready', async () => {
    await page.locator('#np-prompt').fill('A launch page for our bakery');
    await page.locator('.np-kaity [type="submit"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/bakery\/$/);
    await expect.poll(() => page.locator('.bar .status').textContent()).toContain('Kaity is building bakery');
    expect(await page.locator('.tray').isVisible()).toBe(true);
    await expect.poll(() => page.locator('.bar .status').textContent(), { timeout: 30_000 }).toContain('Your page is ready');
    expect(await page.locator('.tray .how').textContent()).toBe('I built a page for the bakery.');
    expect(await page.locator('.jobsteps li').first().textContent()).toMatch(/get layout/);
    await page.locator('[data-bar="job-seen"]').click();
    await page.locator('.bar .hint').waitFor();
    expect(await page.locator('.tray').isHidden()).toBe(true);
  });

  it('starts one from a layout without Kaity', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/new`);
    await page.locator('#np-name').fill('about');
    await page.locator('[data-purpose="organization"]').click();
    expect(await page.locator('[data-np="layout"] [type="submit"]').textContent()).toBe('Create about from it');
    await page.locator('[data-np="layout"] [type="submit"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/about\/$/);
    await page.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    expect(existsSync(join(site, 'about', 'layout.slice'))).toBe(true);
    // without the site's header: the bar is back, with no job
    expect(await page.locator('.bar .hint').isVisible()).toBe(true);
  });

  it('starts one like a page of the site: its navigation, footer and look, one empty section between', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/new?from=about`);
    const like = page.locator('[data-np="like"]');
    // the page it was opened from is chosen
    expect(await like.locator('[data-like="about"]').getAttribute('aria-pressed')).toBe('true');
    await like.locator('[data-like="first"]').click();
    await page.locator('#np-name').fill('contact');
    expect(await like.locator('[type="submit"]').textContent()).toBe('Create contact like first');
    await like.locator('[type="submit"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/contact\/$/);
    await page.frameLocator('.frame').locator('[data-sw="main"]').waitFor();
    const slice = readFileSync(join(site, 'contact', 'layout.slice'), 'utf8');
    expect(slice).toMatch(/\bnav\b/);
    expect(slice).toMatch(/\bfooter\b/);
    expect(slice).not.toMatch(/\bhero\b/);
  });
});
