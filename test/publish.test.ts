// Publishing a site to GitHub (src/publish.ts), against a fake GitHub: an in-memory repository behind the
// few Git Data API calls the publisher makes.

import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MANIFEST, blobSha, publishToGitHub } from '../src/publish.js';
import { newSitePage, publishSettingsError, readSite, removePage, setPublish } from '../src/site.js';
import { freePort } from './ports.js';

/** A repository: blobs by hash, trees as path → blob, commits, branches. Empty until a first commit, like
 * GitHub's (the Git Data API answers 409 there; the Contents API works). A recursive tree listing longer than
 * `limit` comes back cut short (truncated), as GitHub does for big repositories. */
function fakeGitHub(token: string, limit = Infinity) {
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const calls: string[] = [];
  /** A folder of a tree, as a tree of its own (the non-recursive listing's `tree` entries). */
  const subtree = (tree: Map<string, string>, dir: string) => {
    const t = id();
    trees.set(t, new Map([...tree].filter(([p]) => p.startsWith(dir)).map(([p, sha]) => [p.slice(dir.length), sha])));
    return t;
  };
  const id = () => randomBytes(20).toString('hex');
  const commit = (files: Record<string, string>, message: string, parent?: string) => {
    const tree = new Map(Object.entries(files).map(([p, text]) => {
      const b = Buffer.from(text);
      blobs.set(blobSha(b), b);
      return [p, blobSha(b)];
    }));
    const t = id();
    trees.set(t, tree);
    const c = id();
    commits.set(c, { tree: t, parents: parent ? [parent] : [], message });
    return c;
  };
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push(`${req.method} ${req.url}`);
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Bad credentials' });
    const m = /^\/repos\/me\/site(\/.*)$/.exec(req.url ?? '');
    if (!m) return send(404, { message: 'Not Found' });
    const p = m[1];
    let x: RegExpExecArray | null;
    if (req.method === 'PUT' && (x = /^\/contents\/(.+)$/.exec(p))) {
      const branch = body.branch ?? 'main';
      const parent = refs.get(branch);
      const files = parent ? Object.fromEntries([...trees.get(commits.get(parent)!.tree)!].map(([f, sha]) => [f, blobs.get(sha)!.toString()])) : {};
      refs.set(branch, commit({ ...files, [x[1]]: Buffer.from(body.content, 'base64').toString() }, body.message, parent));
      return send(201, {});
    }
    if (!commits.size) return send(409, { message: 'Git Repository is empty.' });
    if (req.method === 'GET' && (x = /^\/git\/ref\/heads\/(.+)$/.exec(p))) {
      const sha = refs.get(x[1]);
      return sha ? send(200, { object: { sha } }) : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (x = /^\/git\/commits\/(\w+)$/.exec(p))) return send(200, { sha: x[1], tree: { sha: commits.get(x[1])!.tree } });
    if (req.method === 'GET' && (x = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(p))) {
      const all = [...trees.get(x[1])!].map(([path, sha]) => ({ path, type: 'blob', sha }));
      return send(200, { truncated: all.length > limit, tree: all.slice(0, limit) });
    }
    if (req.method === 'GET' && (x = /^\/git\/trees\/(\w+)$/.exec(p))) {
      const tree = trees.get(x[1])!;
      const dirs = new Set([...tree.keys()].filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
      return send(200, {
        truncated: false,
        tree: [
          ...[...tree].filter(([f]) => !f.includes('/')).map(([path, sha]) => ({ path, type: 'blob', sha })),
          ...[...dirs].map((d) => ({ path: d, type: 'tree', sha: subtree(tree, `${d}/`) })),
        ],
      });
    }
    if (req.method === 'GET' && (x = /^\/git\/blobs\/(\w+)$/.exec(p))) return send(200, { content: blobs.get(x[1])!.toString('base64'), encoding: 'base64' });
    if (req.method === 'POST' && p === '/git/blobs') {
      const b = Buffer.from(body.content, 'base64');
      blobs.set(blobSha(b), b);
      return send(201, { sha: blobSha(b) });
    }
    if (req.method === 'POST' && p === '/git/trees') {
      const tree = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const e of body.tree) e.sha === null ? tree.delete(e.path) : tree.set(e.path, e.sha);
      const t = id();
      trees.set(t, tree);
      return send(201, { sha: t });
    }
    if (req.method === 'POST' && p === '/git/commits') {
      const c = id();
      commits.set(c, { tree: body.tree, parents: body.parents, message: body.message });
      return send(201, { sha: c, html_url: `https://github.com/me/site/commit/${c}` });
    }
    if (req.method === 'PATCH' && (x = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
      if (!commits.get(body.sha)!.parents.includes(refs.get(x[1])!)) return send(422, { message: 'Update is not a fast forward' });
      refs.set(x[1], body.sha);
      return send(200, {});
    }
    if (req.method === 'POST' && p === '/git/refs') {
      refs.set(body.ref.replace('refs/heads/', ''), body.sha);
      return send(201, {});
    }
    send(404, { message: 'Not Found' });
  });
  /** The files on a branch, as text. */
  const files = (branch: string) => {
    const c = refs.get(branch);
    return c ? Object.fromEntries([...trees.get(commits.get(c)!.tree)!].map(([path, sha]) => [path, blobs.get(sha)!.toString()])) : null;
  };
  return { server, refs, commits, calls, commit, files };
}

vi.setConfig({ testTimeout: 30_000 });

let gh: ReturnType<typeof fakeGitHub>;
let api: string;
beforeAll(async () => {
  gh = fakeGitHub('secret');
  await new Promise<void>((ok) => (gh.server as Server).listen(0, '127.0.0.1', ok));
  api = `http://127.0.0.1:${(gh.server.address() as { port: number }).port}`;
});
afterAll(() => gh.server.close());

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-publish-'));
  for (const p of ['rome', 'munich']) newSitePage(dir, p, 'blank');
  return dir;
}

describe('publish settings', () => {
  it('keeps where the site goes in site.json, checked', () => {
    const dir = site();
    setPublish(dir, { repo: ' me/site ', branch: 'gh-pages', folder: '/docs/', url: 'https://me.github.io/site/' });
    expect(readSite(dir).publish).toEqual({ repo: 'me/site', branch: 'gh-pages', folder: 'docs', url: 'https://me.github.io/site' });
    expect(() => setPublish(dir, { repo: 'just-a-name', branch: 'main', folder: '' })).toThrow(/owner\/name/);
    expect(publishSettingsError({ repo: 'me/site', branch: 'main', folder: '../up' })).toMatch(/folder/);
    expect(publishSettingsError({ repo: 'me/site', branch: 'a..b', folder: '' })).toMatch(/branch/);
    expect(publishSettingsError({ repo: 'me/site', branch: 'main', folder: '', url: 'javascript:alert(1)' })).toMatch(/https/);
    // the credit is on unless turned off, and only "off" is kept
    setPublish(dir, { repo: 'me/site', branch: 'main', folder: '', credit: false });
    expect(readSite(dir).publish).toEqual({ repo: 'me/site', branch: 'main', folder: '', credit: false });
    setPublish(dir, { repo: 'me/site', branch: 'main', folder: '', credit: true });
    expect(readSite(dir).publish).toEqual({ repo: 'me/site', branch: 'main', folder: '' });
    // a broken publish block in site.json is left out, never used
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ version: 1, titles: {}, publish: { repo: 'x' } }));
    expect(readSite(dir).publish).toBeUndefined();
  });
});

describe('publishing to GitHub', () => {
  it('commits the export to a new branch, then only what changed, and removes only what it published', async () => {
    const dir = site();
    const settings = { repo: 'me/site', branch: 'pages', folder: '', url: 'https://example.org' };
    const first = await publishToGitHub(dir, settings, 'secret', { api });
    expect(first.commit?.url).toMatch(/^https:\/\/github\.com\/me\/site\/commit\/\w+$/);
    expect(first).toMatchObject({ changed: 0, removed: 0 });
    const files = gh.files('pages')!;
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['index.html', 'rome/index.html', 'munich/index.html', 'pages/index.html', 'sitemap.xml', '.nojekyll', MANIFEST]));
    expect(first.added).toBe(Object.keys(files).length - 2); // the site's files, not TYKERF's .nojekyll and list
    expect(files['sitemap.xml']).toContain('<loc>https://example.org/rome/</loc>');
    expect(files['rome/index.html']).toContain('Made with TYKERF'); // on by default
    expect(files['404.html']).toContain('<base href="/">');

    // nothing changed: no commit
    expect((await publishToGitHub(dir, settings, 'secret', { api })).commit).toBeNull();

    // someone adds their own file on the branch (a custom domain), and a page is removed
    const head = gh.refs.get('pages')!;
    gh.refs.set('pages', gh.commit({ ...gh.files('pages')!, CNAME: 'example.org' }, 'custom domain', head));
    removePage(dir, 'munich');
    const third = await publishToGitHub(dir, settings, 'secret', { api });
    expect(third.removed).toBeGreaterThan(0);
    const after = gh.files('pages')!;
    expect(after['munich/index.html']).toBeUndefined();
    expect(after.CNAME).toBe('example.org'); // not TYKERF's: kept
    expect(after['rome/index.html']).toBeDefined();
    expect(JSON.parse(after[MANIFEST]).files).not.toContain('munich/index.html');
  });

  it('publishes into a folder of an existing branch, next to what is there', async () => {
    const dir = site();
    gh.refs.set('main', gh.commit({ 'README.md': '# my site', 'src/notes.txt': 'mine' }, 'start'));
    await publishToGitHub(dir, { repo: 'me/site', branch: 'main', folder: 'docs' }, 'secret', { api });
    const files = gh.files('main')!;
    expect(files['README.md']).toBe('# my site');
    expect(files['src/notes.txt']).toBe('mine');
    expect(files['docs/rome/index.html']).toBeDefined();
    expect(files['docs/.nojekyll']).toBe('');
    expect(files['sitemap.xml']).toBeUndefined(); // no public address: no sitemap
    // without the credit
    await publishToGitHub(dir, { repo: 'me/site', branch: 'main', folder: 'docs', credit: false }, 'secret', { api });
    expect(gh.files('main')!['docs/rome/index.html']).not.toContain('Made with TYKERF');
  });

  it('starts an empty repository with a README, and lists a big one folder by folder', async () => {
    const big = fakeGitHub('secret', 3);
    await new Promise<void>((ok) => big.server.listen(0, '127.0.0.1', ok));
    const bigApi = `http://127.0.0.1:${(big.server.address() as { port: number }).port}`;
    try {
      const dir = site();
      const settings = { repo: 'me/site', branch: 'gh-pages', folder: '' };
      const first = await publishToGitHub(dir, settings, 'secret', { api: bigApi });
      expect(first.commit).not.toBeNull();
      expect(big.files('main')).toEqual({ 'README.md': '# site\n\nA site published with TYKERF.\n' });
      expect(big.files('gh-pages')!['rome/index.html']).toBeDefined();
      // every listing of gh-pages is cut short at 3 files: the publisher walks the folders and still sees them all
      expect((await publishToGitHub(dir, settings, 'secret', { api: bigApi })).commit).toBeNull();
      expect(big.calls).toContainEqual(expect.stringMatching(/^GET \/repos\/me\/site\/git\/trees\/\w+$/));
      removePage(dir, 'munich');
      const third = await publishToGitHub(dir, settings, 'secret', { api: bigApi });
      expect(third).toMatchObject({ added: 0, changed: expect.any(Number) });
      expect(third.removed).toBeGreaterThan(0);
      expect(big.files('gh-pages')!['munich/index.html']).toBeUndefined();
      // into a folder of a big branch: the same, from that folder down
      const docs = { repo: 'me/site', branch: 'main', folder: 'docs' };
      await publishToGitHub(dir, docs, 'secret', { api: bigApi });
      expect((await publishToGitHub(dir, docs, 'secret', { api: bigApi })).commit).toBeNull();
      expect(big.files('main')!['README.md']).toBeDefined();
    } finally {
      big.server.close();
    }
  });

  it('says what is wrong in words: a bad token, a repository it cannot reach', async () => {
    const dir = site();
    await expect(publishToGitHub(dir, { repo: 'me/site', branch: 'main', folder: '' }, 'wrong', { api })).rejects.toThrow(/refused the token/);
    await expect(publishToGitHub(dir, { repo: 'me/other', branch: 'main', folder: '' }, 'secret', { api })).rejects.toThrow(/doesn't let this token write to me\/other/);
  });
});

describe('Publish in the site manager', () => {
  let editor: ChildProcess;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = site();
    const port = await freePort();
    editor = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', dir, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_GITHUB_TOKEN: 'secret', TYKERF_GITHUB_API: api },
    });
    await new Promise<void>((ok) => editor.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok()));
    url = `http://localhost:${port}/`;
  }, 30_000);
  afterAll(() => editor?.kill());

  it('says where to, publishes, says what went, and keeps the last publish', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${url}_tykerf/site/`);
      await page.locator('.publish-btn').click();
      await page.locator('.publish .token', { hasText: 'token: set' }).waitFor();
      await page.locator('.publish [name=repo]').fill('me');
      await page.locator('[data-pub="save"]').click();
      await page.locator('.publish .msg.error', { hasText: 'owner/name' }).waitFor();
      await page.locator('.publish [name=repo]').fill('me/site');
      await page.locator('.publish [name=branch]').fill('live');
      expect(await page.locator('.publish [name=credit]').isChecked()).toBe(true);
      await page.locator('[data-pub="publish"]').click();
      await page.locator('.publish .msg', { hasText: /^Published: \d+ new, 0 changed and 0 removed files/ }).waitFor({ timeout: 15_000 });
      expect(await page.locator('.publish .last a').first().getAttribute('href')).toMatch(/^https:\/\/github\.com\/me\/site\/commit\//);
      expect(gh.files('live')!['rome/index.html']).toBeDefined();
      expect(readSite(dir).publish).toEqual({ repo: 'me/site', branch: 'live', folder: '' });
      await page.locator('[data-pub="publish"]').click();
      await page.locator('.publish .msg', { hasText: 'Nothing changed since the last publish.' }).waitFor();
    } finally {
      await browser.close();
    }
  });

  it('tells the manager where the site went last, never the token', async () => {
    const st = await fetch(`${url}_tykerf/site/publish`).then((r) => r.json());
    expect(st).toMatchObject({ ok: true, site: true, token: true, last: { repo: 'me/site', branch: 'live' } });
    expect(JSON.stringify(st)).not.toContain('secret'); // the token never leaves the server
  });
});
