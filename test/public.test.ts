// TYKERF serving a site to visitors (TYKERF_ADMIN_PASSWORD, src/editor/auth.ts): visitors get the pages as
// they are, and only the signed-in admin gets the editor, its addresses and the site manager.

import { type ChildProcess, spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage } from '../src/library.js';
import { newSitePage, readSite, sitePages } from '../src/site.js';
import { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

let server: ChildProcess;
let url: string;

beforeAll(async () => {
  const site = mkdtempSync(join(tmpdir(), 'tykerf-public-'));
  for (const name of ['rome', 'munich']) createPage(new Workspace(join(site, name)), 'blank');
  const port = await freePort();
  server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_ADMIN_PASSWORD: 'open sesame' } });
  // an editor that can't start fails the setup at once, not after the timeout
  await new Promise<void>((ok, fail) => {
    server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
    server.once('exit', (code) => fail(new Error(`the editor stopped (exit ${code}) before it was ready`)));
  });
  url = `http://localhost:${port}/`;
}, 30_000);
afterAll(() => server?.kill());

const get = (path: string, cookie = '') => fetch(`${url}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const post = (path: string, data: unknown, cookie = '') => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });

describe('a site served to visitors', () => {
  it('shows visitors the pages without the editor, and keeps the editor closed', async () => {
    const page = await get('rome/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain('tykerf.js');
    // only a browser that signed in here before gets Edit with TYKERF (the login page leaves tykerf.admin)
    expect(html).toContain("if(localStorage.getItem('tykerf.admin')==='true')");
    expect(html).toContain("'/_tykerf/login?next='+encodeURIComponent(location.pathname+location.search)");
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'); // the site's icon, not TYKERF's
    const list = await get('pages/');
    expect(await list.text()).toContain('<a href="/_tykerf/login?next=%2F_tykerf%2Fsite%2F" rel="nofollow">Sign in to edit</a>');
    expect((await get('')).headers.get('location')).toBe('/pages/'); // no home page yet: the list
    expect((await get('_tykerf/site/')).headers.get('location')).toBe('/_tykerf/login?next=%2F_tykerf%2Fsite%2F');
    expect((await get('rome/_tykerf/state')).status).toBe(401);
    expect((await get('_tykerf/site')).status).toBe(401);
    expect((await post('_tykerf/site/new', { name: 'x', layout: 'blank' })).status).toBe(401);
    expect((await get('_tykerf/login')).status).toBe(200);
    // the site's icon, and TYKERF's for the sign-in page; no other editor file
    const icon = await get('favicon.svg');
    expect([icon.status, icon.headers.get('content-type')]).toEqual([200, 'image/svg+xml']);
    expect((await get('_tykerf/favicon.svg')).status).toBe(200);
    expect((await get('_tykerf/tykerf.css')).status).toBe(401);
    // an address under a page that isn't there: not found, not a refusal
    const under = await get('rome/asdfad');
    expect([under.status, await under.text()]).toEqual([404, expect.stringContaining("This page isn't here")]);
    const gone = await get('paris/');
    expect([gone.status, await gone.text()]).toEqual([404, expect.stringContaining('href="/pages/"')]);
  });

  it('lets the admin in with the password, and out again', async () => {
    expect((await post('_tykerf/login', { password: 'wrong' })).status).toBe(401);
    const ok = await post('_tykerf/login', { password: 'open sesame' });
    expect(ok.status).toBe(200);
    const set = ok.headers.get('set-cookie')!;
    expect(set).toMatch(/^tykerf_session=[\w-]{20,}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    const cookie = set.split(';')[0];
    const own = await (await get('rome/', cookie)).text();
    expect(own).toContain('_tykerf/tykerf.js');
    expect(own).not.toContain('tykerf.admin'); // the editor, not the way to it
    // TYKERF's own address is the manager; the sign-in page, once signed in, goes straight on
    expect((await get('_tykerf/', cookie)).headers.get('location')).toBe('/_tykerf/site/');
    expect((await get('_tykerf', cookie)).headers.get('location')).toBe('/_tykerf/site/');
    expect((await get('_tykerf/login?next=%2Frome%2F', cookie)).headers.get('location')).toBe('/rome/');
    expect((await get('_tykerf/login?next=%2F%2Fevil.example', cookie)).headers.get('location')).toBe('/_tykerf/site/');
    expect(await (await get('_tykerf/site', cookie)).json()).toMatchObject({ pages: ['munich', 'rome'], signin: true });
    expect((await get('_tykerf/site/', cookie)).status).toBe(200);
    expect(await (await get('pages/', cookie)).text()).toContain('<a href="/_tykerf/site/" rel="nofollow">Site manager</a>');
    expect((await post('_tykerf/logout', {}, cookie)).headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await get('_tykerf/site', cookie)).status).toBe(401); // that session is over
  });

  it('stops a guesser for a while after a few wrong passwords', async () => {
    const tries = [];
    for (let i = 0; i < 6; i++) tries.push((await post('_tykerf/login', { password: `guess ${i}` })).status);
    expect(tries.at(-1)).toBe(429);
    expect((await post('_tykerf/login', { password: 'open sesame' })).status).toBe(429); // even the right one, until it waits
  }, 30_000);
});

describe('behind an HTTPS proxy', () => {
  let proxied: ChildProcess;
  let port: number;

  beforeAll(async () => {
    const site = mkdtempSync(join(tmpdir(), 'tykerf-public-'));
    createPage(new Workspace(join(site, 'rome')), 'blank');
    port = await freePort();
    proxied = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_ADMIN_PASSWORD: 'open sesame', TYKERF_PUBLIC_URL: 'https://cities.example.org' },
    });
    await new Promise<void>((ok, fail) => {
      proxied.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      proxied.once('exit', (code) => fail(new Error(`the editor stopped (exit ${code}) before it was ready`)));
    });
  }, 30_000);
  afterAll(() => proxied?.kill());

  /** A request as the proxy passes it on: the public host name, and the browser's https origin. */
  const via = (path: string, origin: string, body: unknown) => new Promise<{ status: number; cookie: string }>((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: 'cities.example.org', origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' } }, (res) => {
      res.resume();
      ok({ status: res.statusCode!, cookie: String(res.headers['set-cookie'] ?? '') });
    });
    req.on('error', fail);
    req.end(JSON.stringify(body));
  });

  it('signs the admin in from the public https address, with a Secure cookie, and still refuses other origins', async () => {
    const ok = await via('/_tykerf/login', 'https://cities.example.org', { password: 'open sesame' });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/; Secure$/);
    expect((await via('/_tykerf/login', 'https://evil.example.com', { password: 'open sesame' })).status).toBe(403);
    expect((await via('/_tykerf/login', 'http://cities.example.org.evil.com', { password: 'open sesame' })).status).toBe(403);
  });
});

describe('a page folder given to the editor', () => {
  const started = async (dir: string, ...more: string[]) => {
    const one = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', dir, ...more, '--port', String(await freePort())], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TYKERF_DOTENV: 'off' } });
    let out = '';
    one.stdout!.on('data', (d) => (out += d));
    one.stderr!.on('data', (d) => (out += d));
    return new Promise<{ code: number | null; out: string; one: ChildProcess }>((ok) => {
      one.stdout!.on('data', () => out.includes('TYKERF: http') && ok({ code: null, out, one }));
      one.once('exit', (code) => ok({ code, out, one }));
    });
  };

  it('opens the site of a page of a site', async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-public-page-')), 'cv');
    createPage(new Workspace(join(site, 'home')), 'blank');
    const r = await started(join(site, 'home'));
    try {
      expect(r.out).toContain(`is a page of the site ${site}: opening the site (the page is at /home/)`);
      expect(r.out).toMatch(/TYKERF: http.*\(site .*cv, 1 pages/);
    } finally {
      r.one.kill();
    }
  });

  it('starts a new site with --layout, its home page named home or --name', async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-public-new-')), 'studio');
    const r = await started(site, '--layout', 'blank', '--name', 'portfolio');
    try {
      expect(r.out).toContain(`started a new site in ${site} with its home page "portfolio" from the "blank" layout`);
      expect([sitePages(site), readSite(site).home]).toEqual([['portfolio'], 'portfolio']);
    } finally {
      r.one.kill();
    }
    const bad = await started(join(mkdtempSync(join(tmpdir(), 'tykerf-public-new-')), 'studio'), '--layout', 'blank', '--name', 'Bad Name');
    bad.one.kill();
    expect([bad.code, bad.out]).toEqual([1, expect.stringContaining(`"Bad Name" can't be a page name`)]);
  });

  it('adds a page to a site with --layout and --name, once; without --name it says how', async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-public-add-')), 'studio');
    newSitePage(site, 'jap', 'blank', 'studio');
    const added = await started(site, '--layout', 'biased', '--theme', 'biased', '--name', 'jap2');
    try {
      expect(added.out).toMatch(/added the page "jap2" to the site .*studio from the "biased" layout: http:\/\/localhost:\d+\/jap2\//);
      expect(added.out).toContain('the "biased" theme is "jap2"\'s own values over it'); // the other pages keep their look
      expect([sitePages(site), readSite(site).home]).toEqual([['jap', 'jap2'], 'jap']); // the home page stays
    } finally {
      added.one.kill();
    }
    const again = await started(site, '--layout', 'biased', '--name', 'jap2'); // the same command, run again
    again.one.kill();
    expect(again.out).toContain('already has a page "jap2"; --layout is only used for a new page');
    expect(sitePages(site)).toEqual(['jap', 'jap2']);
    const unnamed = await started(site, '--layout', 'biased');
    unnamed.one.kill();
    expect([unnamed.code, unnamed.out]).toEqual([1, expect.stringContaining('to add one from the "biased" layout, name it with --name')]);
  });

  it('refuses a page on its own, and says how to put it in a site', async () => {
    // a page in a folder of other things (a home folder), so it belongs to no site
    const home = mkdtempSync(join(tmpdir(), 'tykerf-public-home-'));
    mkdirSync(join(home, 'Documents'));
    writeFileSync(join(home, 'Documents', 'notes.txt'), 'not a page');
    const dir = join(home, 'cv');
    createPage(new Workspace(dir), 'blank');
    const r = await started(dir);
    r.one.kill(); // already gone, unless it wrongly started
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${dir} is a page on its own; TYKERF edits sites, folders of pages`);
    expect(r.out).toContain(`mv ${dir} my-site/home`);
  });
});
