// New page in the v4 editor (shell/newpage.js): one screen in the shared frame with its ways to start as tabs.
// Describe it to Kaity builds a brief from five questions (exactly what she gets, files attached); From a kind of
// page shows a live preview that follows every choice, Full size over the screen; Like a page of this site. A site
// with no pages opens on its first run, whose page becomes the home page. The editor runs the Anthropic runner
// against a fake API, which keeps what Kaity was sent.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newSitePage, readSite } from '../src/site.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 45_000 });

const message = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

describe('a new page in the v4 editor', () => {
  let api: Server;
  const sent: { role: string; content: { type: string; text?: string; source?: { media_type?: string } }[] }[][] = [];
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
      sent.push(body.messages);
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

  const main = () => page.locator('.screen');

  it('opens from + New page in the rail, in the same frame, the page shown as being set up', async () => {
    await page.goto(`${base}/_tykerf/edit/first/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    // on a page, + New page is in the rail's Site section
    await page.locator('.rail [data-acc="site"]').click();
    await page.locator('.rail [data-screen="new"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/_site\/new\?from=first$/);
    await main().locator('h1', { hasText: 'New page' }).waitFor();
    // the same top bar and rail; the rail shows the new page as being set up; Cancel goes back
    expect(await page.locator('.bar .crumb b').textContent()).toBe('New page');
    await expect.poll(() => page.locator('.rail .rpage.pending').textContent()).toBe('page-2being set up');
    expect(await main().locator('[data-cancel]').getAttribute('href')).toBe('/_tykerf/edit/first/');
    expect(await main().locator('.nptab b').allTextContents()).toEqual(['Describe it to Kaity', 'From a kind of page', 'Copy a web page', 'Like a page of this site']);
    expect(await main().locator('.nptab[aria-selected="true"] b').textContent()).toBe('Describe it to Kaity');
    expect(await page.locator('#np-name').inputValue()).toBe('page-2');
    await page.locator('#np-name').fill('first');
    await expect.poll(() => page.locator('.rail .rpage.pending').textContent()).toBe('firstbeing set up');
    await main().locator('[data-go="kaity"]').click();
    expect(await main().locator('.np-error').first().textContent()).toBe('There is already a page called first.');
  });

  it('asks five questions and shows the brief they make, which is what Kaity gets, with the files attached', async () => {
    const brief = () => main().locator('[name="brief"]').inputValue();
    // no kind chosen at first: the question can be skipped; a second click takes a choice back
    expect(await main().locator('[data-kind][aria-pressed="true"]').count()).toBe(0);
    await main().locator('[data-kind="place"]').click();
    await main().locator('[data-kind="place"]').click();
    expect(await main().locator('[data-kind][aria-pressed="true"]').count()).toBe(0);
    await main().locator('[data-kind="person"]').click();
    // Attach is the composers' button, with the clip
    expect(await main().locator('[data-attach]').textContent()).toBe('Attach');
    expect(await main().locator('[data-attach] svg').count()).toBe(1);
    // the sections suggested are the person purpose's own, all ticked
    expect(await main().locator('[data-section]').allTextContents()).toEqual(['Intro', 'About', 'Experience', 'Work', 'Contact']);
    await main().locator('[data-section="Work"]').click();
    await main().locator('#np-who').fill('founders of EdTech companies, who should contact me');
    await main().locator('[name="newsection"]').fill('Services');
    await main().locator('[data-addsection]').click();
    await main().locator('[data-tone="warm"]').click();
    await main().locator('#np-more').fill('No top navigation: it is a one-page site.');
    // a PDF, attached with Attach files
    const chooser = page.waitForEvent('filechooser');
    await main().locator('[data-attach]').click();
    await (await chooser).setFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF') });
    await main().locator('.fchip', { hasText: 'cv.pdf' }).waitFor();
    expect(await brief()).toBe('A person page for founders of EdTech companies, who should contact me.\nSections: intro, about, experience, contact, services.\nTone: warm.\nNo top navigation: it is a one-page site.\nAttached: cv.pdf');
    // the brief can be written over; the answers make it again
    await main().locator('[name="brief"]').fill('A person page for EdTech founders. Use my CV.');
    await main().locator('[data-tone="bold"]').click();
    expect(await brief()).toBe('A person page for EdTech founders. Use my CV.');
    await main().locator('[data-rebuild]').click();
    expect(await brief()).toMatch(/^A person page for founders of EdTech companies, who should contact me\.\n.*\nTone: bold\./);
    await main().locator('[name="brief"]').fill('A person page for EdTech founders. Use my CV.');
    await page.locator('#np-name').fill('bakery');
    await main().locator('[data-go="kaity"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/bakery\/$/);
    // she got the brief as it was shown, and the PDF as a document
    await expect.poll(() => sent.length).toBeGreaterThan(0);
    const first = sent[0][0].content;
    expect(first.find((c) => c.type === 'text')!.text).toMatch(/^A person page for EdTech founders\. Use my CV\./);
    expect(first.find((c) => c.type === 'document')?.source?.media_type).toBe('application/pdf');
    // the page opens at once, the status line and the tray show her at work, then that it is ready
    await expect.poll(() => page.locator('.pstatus .status').textContent()).toContain('Kaity is building bakery');
    expect(await page.locator('.tray').isVisible()).toBe(true);
    await expect.poll(() => page.locator('.pstatus .status').textContent(), { timeout: 30_000 }).toContain('Your page is ready');
    expect(await page.locator('.tray .how').textContent()).toBe('I built a page for the bakery.');
    expect(await page.locator('.jobsteps li').first().textContent()).toMatch(/get layout/);
    await page.locator('[data-bar="job-seen"]').click();
    await page.locator('.pstatus').waitFor({ state: 'hidden' });
    expect(await page.locator('.tray').isHidden()).toBe(true);
  });

  it('starts from a kind of page beside a live preview that follows every choice, full size over the screen', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/new?start=kind`);
    const src = () => main().locator('.pvframe').getAttribute('src');
    await main().locator('.pvframe').waitFor();
    // no kind chosen yet: just the frame
    expect(await src()).toMatch(/^\/_tykerf\/preview\/(simple|basic|full)\/site\/\?side=0$/);
    await main().locator('[data-purpose="person"]').click();
    expect(await src()).toMatch(/\+person\//);
    // one choice for both tabs: Describe has it too
    await main().locator('[data-start="describe"]').click();
    expect(await main().locator('[data-kind][aria-pressed="true"]').getAttribute('data-kind')).toBe('person');
    await main().locator('[data-start="kind"]').click();
    await main().locator('.pvframe').waitFor();
    await main().locator('[data-frame="full"]').click();
    expect(await src()).toBe('/_tykerf/preview/full+person/site/?side=0');
    // the side menu and the side note are in the preview only when they are ticked
    await main().locator('[name="side"]').check();
    await expect.poll(src).toBe('/_tykerf/preview/full+person/site/?side=1');
    // another theme: the preview takes it, and the screen says it won't match the other pages
    await main().locator('[data-theme="ivory"]').click();
    expect(await src()).toBe('/_tykerf/preview/full+person/ivory/?side=1');
    expect(await main().locator('.np-controls .warn').textContent()).toBe('A page in another theme no longer matches the rest of the site.');
    // a warning, not an error: not red
    expect(await main().locator('.np-controls .warn').evaluate((e) => getComputedStyle(e).color)).not.toBe('rgb(180, 35, 24)');
    await main().locator('[data-theme="site"]').click();
    // the widths, and Full size over this screen: never a new tab, and Back keeps every choice
    await main().locator('[data-pdevice="phone"]').click();
    expect(await main().locator('.pvframe').evaluate((f) => (f as HTMLElement).style.width)).toBe('375px');
    const pages = browser.contexts()[0].pages().length;
    await main().locator('[data-fullsize]').click();
    const full = page.locator('.fullsize');
    await full.waitFor();
    expect(await full.locator('iframe').getAttribute('src')).toBe('/_tykerf/preview/full+person/site/?side=1');
    expect(browser.contexts()[0].pages().length).toBe(pages);
    await full.locator('[data-back]').click();
    expect(await full.count()).toBe(0);
    expect(await main().locator('[data-frame="full"]').getAttribute('aria-pressed')).toBe('true');
    expect(await main().locator('[name="side"]').isChecked()).toBe(true);
    // the preview is the page as made: rendered with the frame's side menu now
    expect(await (await fetch(`${base}/_tykerf/preview/full+person/site/?side=1`)).text()).toContain('data-sw="side"');
    expect(await (await fetch(`${base}/_tykerf/preview/full+person/site/?side=0`)).text()).not.toContain('data-sw="side"');
    await main().locator('[data-purpose="organization"]').click();
    await page.locator('#np-name2').fill('about');
    expect(await main().locator('[data-go="layout"]').textContent()).toBe('Create about and open it');
    // the create actions stay in view at the bottom of the screen (here at 1400×863), scrolled or not
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 1400, height: 863 });
    await main().evaluate((m) => m.closest('.screen, main')?.scrollTo?.(0, 0));
    const go = (await main().locator('[data-go="layout"]').boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(863);
    await page.setViewportSize(size);
    await main().locator('[data-go="layout"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/about\/$/);
    await page.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    expect(existsSync(join(site, 'about', 'layout.slice'))).toBe(true);
    expect(await page.locator('.modetag').textContent()).toBe('Tasks');
  });

  it('makes one and asks Kaity to fill it: the page opens with the composer on the whole page', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/new?start=kind`);
    await main().locator('.pvframe').waitFor();
    await page.locator('#np-name2').fill('team');
    await main().locator('[data-go="fill"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/team\/$/);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.pagecol .composer'))).toBe(true);
    expect(await page.locator('.pagecol .composer select option:checked').textContent()).toBe('This page');
  });

  it('starts one like a page of the site: its navigation, footer and look, one empty section between', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/new?start=like&from=about`);
    const like = page.locator('[data-np="like"]');
    // the page it was opened from is chosen
    expect(await like.locator('[data-like="about"]').getAttribute('aria-pressed')).toBe('true');
    await like.locator('[data-like="first"]').click();
    await page.locator('#np-name4').fill('contact');
    expect(await like.locator('[type="submit"]').textContent()).toBe('Create contact like first');
    await like.locator('[type="submit"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/contact\/$/);
    await page.frameLocator('.frame').locator('[data-sw="main"]').waitFor();
    const slice = readFileSync(join(site, 'contact', 'layout.slice'), 'utf8');
    expect(slice).toMatch(/\bnav\b/);
    expect(slice).toMatch(/\bfooter\b/);
    expect(slice).not.toMatch(/\bhero\b/);
  });

  it('welcomes a site with no pages on its Overview, and its first page becomes the home page', async () => {
    const empty = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-first-')), 'site');
    const port = await freePort();
    const other = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', empty, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_DOTENV: 'off' } });
    try {
      await new Promise<void>((ok) => other.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok()));
      const at = `http://localhost:${port}`;
      await page.goto(`${at}/`);
      await page.waitForURL(`${at}/_tykerf/edit/_site/`); // no redirect to New page
      await main().locator('.ofirst h1').waitFor();
      expect(await page.locator('.bar .crumb b').textContent()).toBe('Welcome');
      expect(await main().locator('.osteps b').allTextContents()).toEqual(['Create your first page', 'Click anything on it and say what should change', 'Check and publish']);
      expect(await main().locator('.odocs li a').count()).toBe(5);
      expect(await main().locator('.ostart h3').allTextContents()).toEqual(['Describe it to Kaity', 'Start from a kind of page', 'Copy a web page']);
      await main().locator('.ostart[data-start="kind"]').click();
      await page.waitForURL(`${at}/_tykerf/edit/_site/new?start=kind`);
      expect(await main().locator('.nptab[aria-selected="true"] b').textContent()).toBe('From a kind of page');
      expect(await main().locator('.nptab').count()).toBe(3); // nothing to be like yet
      expect(await page.locator('#np-name2').inputValue()).toBe('home');
      await main().locator('[data-go="layout"]').click();
      await page.waitForURL(`${at}/_tykerf/edit/home/`);
      expect(readSite(empty).home).toBe('home');
    } finally {
      other.kill();
    }
  });
});
