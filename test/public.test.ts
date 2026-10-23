// TYKERF serving a site to visitors (TYKERF_ADMIN_PASSWORD, src/editor/auth.ts): visitors get the pages as
// they are, and only the signed-in admin gets the editor, its addresses and the site manager.

import { type ChildProcess, spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage } from '../src/library.js';
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
    expect(await (await get('rome/', cookie)).text()).toContain('_tykerf/tykerf.js');
    expect(await (await get('_tykerf/site', cookie)).json()).toMatchObject({ kind: 'site', pages: ['munich', 'rome'], signin: true });
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
