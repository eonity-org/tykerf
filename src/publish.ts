// Publishing a site to a GitHub repository: the export (export.ts) committed to a branch through GitHub's
// Git Data API, without git on the machine. GitHub Pages, Cloudflare Pages or Netlify, connected to the
// repository once, deploy each commit. One publish = one commit, so the repository's history is the list of
// publishes, and reverting a commit takes a publish back.
//
// Only what changed is uploaded (files are compared by their git blob hash), and only files TYKERF published
// before are ever deleted: the folder keeps a list of them (MANIFEST). A repository's own files (CNAME,
// README, the site's source on another folder) are never touched.

import { createHash } from 'node:crypto';
import { type ExportReport, exportFiles } from './export.js';
import type { PublishSettings } from './site.js';
import type { ZipFile } from './zip.js';

/** The files TYKERF put in the folder at the last publish. */
export const MANIFEST = '.tykerf-published.json';

export interface PublishResult {
  /** The new commit (null when nothing changed since the last publish). */
  commit: { sha: string; url: string } | null;
  added: number;
  changed: number;
  removed: number;
  /** What the export found (broken links, files still loaded from other servers). */
  report: ExportReport;
}

export interface PublishOptions {
  /** GitHub's API (TYKERF_GITHUB_API: GitHub Enterprise, or a fake one in the tests). */
  api?: string;
  message?: string;
  fetch?: typeof fetch;
}

/** The hash git gives a file's content, to know which files changed without downloading them. */
export const blobSha = (bytes: Uint8Array) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** The files a publish writes in the folder: the export, plus .nojekyll (GitHub Pages serves every file as it is) and the list. */
export function publishFiles(dir: string, settings: PublishSettings): { files: ZipFile[]; report: ExportReport } {
  const { files, report } = exportFiles(dir, { publicUrl: settings.url, credit: settings.credit !== false });
  const enc = new TextEncoder();
  const all = [...files, { path: '.nojekyll', bytes: new Uint8Array() }];
  const list = { by: 'TYKERF', note: 'The files TYKERF publishes here. It replaces and removes only these.', files: all.map((f) => f.path).sort() };
  all.push({ path: MANIFEST, bytes: enc.encode(`${JSON.stringify(list, null, 2)}\n`) });
  return { files: all, report };
}

class GitHubError extends Error {}
/** A repository without a first commit, where GitHub's Git Data API refuses everything. */
class EmptyRepository extends GitHubError {}

type Tree = { tree: { path: string; type: string; sha: string }[]; truncated: boolean };

export async function publishToGitHub(dir: string, settings: PublishSettings, token: string, opts: PublishOptions = {}): Promise<PublishResult> {
  const api = (opts.api ?? 'https://api.github.com').replace(/\/+$/, '');
  const go = opts.fetch ?? fetch;
  const { repo, branch } = settings;
  const prefix = settings.folder ? `${settings.folder}/` : '';

  async function gh<T>(method: string, path: string, body?: unknown, ok404 = false): Promise<T | null> {
    const r = await go(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'TYKERF',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return (await r.json()) as T;
    if (ok404 && r.status === 404) return null;
    const why = String(((await r.json().catch(() => ({}))) as { message?: string }).message ?? '');
    if (r.status === 401) throw new GitHubError('GitHub refused the token (TYKERF_GITHUB_TOKEN): it may have expired or been mistyped');
    if (r.status === 403 || r.status === 404) throw new GitHubError(`GitHub doesn't let this token write to ${repo}: check the repository's name, and that the token has Contents: read and write on it`);
    if (r.status === 409 && /empty/i.test(why)) throw new EmptyRepository(`the repository ${repo} is empty: add a first file on GitHub (a README), then publish again`);
    if (r.status === 422 && /fast.forward/i.test(why)) throw new GitHubError(`the branch ${branch} changed while publishing; publish again`);
    throw new GitHubError(`GitHub answered ${r.status}${why ? `: ${why}` : ''}`);
  }

  const { files, report } = publishFiles(dir, settings);

  // where the branch is now (a new branch starts with nothing), and what its files are. An empty repository
  // first gets a README through the Contents API (the one that works there), on its default branch.
  const branchHead = () => gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`, undefined, true);
  let ref: { object: { sha: string } } | null;
  try {
    ref = await branchHead();
  } catch (e) {
    if (!(e instanceof EmptyRepository)) throw e;
    const readme = `# ${repo.split('/')[1]}\n\nA site published with TYKERF${settings.url ? `: ${settings.url}` : ''}.\n`;
    await gh('PUT', '/contents/README.md', { message: 'Start the repository for TYKERF', content: Buffer.from(readme).toString('base64') });
    ref = await branchHead();
  }
  const parent = ref?.object.sha ?? null;
  let baseTree: string | null = null;
  const there = new Map<string, string>(); // path → blob sha, in the folder only
  // the files under a tree; when GitHub cuts a big answer short (truncated), folder by folder
  async function walk(sha: string, base: string): Promise<void> {
    const all = (await gh<Tree>('GET', `/git/trees/${sha}?recursive=1`))!;
    if (!all.truncated) {
      for (const e of all.tree) if (e.type === 'blob') there.set(base + e.path, e.sha);
      return;
    }
    for (const e of (await gh<Tree>('GET', `/git/trees/${sha}`))!.tree) {
      if (e.type === 'blob') there.set(base + e.path, e.sha);
      else if (e.type === 'tree') await walk(e.sha, `${base}${e.path}/`);
    }
  }
  if (parent) {
    const commit = (await gh<{ tree: { sha: string } }>('GET', `/git/commits/${parent}`))!;
    baseTree = commit.tree.sha;
    // down to the folder first, so a big repository's other files aren't listed
    let at: string | null = baseTree;
    let base = '';
    for (const part of settings.folder ? settings.folder.split('/') : []) {
      const sub: { sha: string } | undefined = (await gh<Tree>('GET', `/git/trees/${at}`))!.tree.find((e) => e.type === 'tree' && e.path === part);
      at = sub?.sha ?? null;
      if (!at) break;
      base += `${part}/`;
    }
    if (at) await walk(at, base);
  }

  // what TYKERF published there before: only those files may go
  let before: string[] = [];
  const listSha = there.get(prefix + MANIFEST);
  if (listSha) {
    const blob = (await gh<{ content: string }>('GET', `/git/blobs/${listSha}`))!;
    try {
      const old = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'));
      if (Array.isArray(old.files)) before = old.files.filter((f: unknown) => typeof f === 'string');
    } catch {}
  }

  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  const upload = files.filter((f) => there.get(prefix + f.path) !== blobSha(f.bytes));
  // the counts are the site's files: .nojekyll and the list are TYKERF's bookkeeping
  const site = upload.filter((f) => f.path !== MANIFEST && f.path !== '.nojekyll');
  const added = site.filter((f) => !there.has(prefix + f.path)).length;
  const changed = site.length - added;
  // a few uploads at a time: fast, and well under GitHub's limits
  for (let i = 0; i < upload.length; i += 6) {
    await Promise.all(upload.slice(i, i + 6).map(async (f) => {
      const blob = (await gh<{ sha: string }>('POST', '/git/blobs', { content: Buffer.from(f.bytes).toString('base64'), encoding: 'base64' }))!;
      entries.push({ path: prefix + f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }));
  }
  const now = new Set(files.map((f) => f.path));
  const gone = before.filter((f) => !now.has(f) && there.has(prefix + f));
  for (const f of gone) entries.push({ path: prefix + f, mode: '100644', type: 'blob', sha: null });
  // nothing of the site changed: no commit
  if (!site.length && !gone.length) return { commit: null, added: 0, changed: 0, removed: 0, report };

  entries.sort((a, b) => a.path.localeCompare(b.path));
  const tree = (await gh<{ sha: string }>('POST', '/git/trees', { ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }))!;
  const message = opts.message ?? `Publish the site with TYKERF (${added} new, ${changed} changed, ${gone.length} removed)`;
  const commit = (await gh<{ sha: string; html_url: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: parent ? [parent] : [] }))!;
  if (parent) await gh('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha });
  else await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
  return { commit: { sha: commit.sha, url: commit.html_url }, added, changed, removed: gone.length, report };
}
