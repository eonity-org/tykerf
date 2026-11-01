// Export: a page or a whole site as plain, self-contained files to put on any web host.
//
//   site/                       export/
//     head.html, assets/     →    assets/…          (the site's shared theme and its fonts)
//     home/   (a TYKERF page)  →    index.html        (opens the first page)
//     about/                      home/index.html, home/assets/…
//                                 about/index.html, …
//
// Each page is rendered as the editor shows it, without TYKERF's script. Addresses written from the
// site root (links between pages "/about/", see site.ts) become relative, so the export works at a
// domain's root, under a sub-path, or opened from disk. Nothing of TYKERF's own state goes along
// (history, AI conversations, box types, image records).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { linkedPage, pageTitle, pageWorkspace, readSite, siteIndex, siteKind, siteIcon, siteMap, siteOf, sitePages, TYKERF_REPO, withCredit } from './site.js';
import { FolderStore } from './store.js';
import { KIT_LOADER, kitList, kitRead } from './kit.js';
import { Workspace } from './workspace.js';
import { type ZipFile, zip } from './zip.js';

export interface ExportOptions {
  /** Links between pages point at …/index.html, for opening the export from disk without a web server. */
  files?: boolean;
  /** The site's public address (TYKERF_PUBLIC_URL): with it, the export has a sitemap.xml. */
  publicUrl?: string | null;
  /** "Made with TYKERF" at the bottom of every page, and in the list of pages (Publish, unless turned off). */
  credit?: boolean;
}

export interface ExportReport {
  pages: string[];
  files: number;
  bytes: number;
  /** Links to pages that aren't in the site. */
  broken: { page: string; href: string }[];
  /** Images, fonts, stylesheets and scripts the pages still load from other servers. */
  remote: { page: string; url: string }[];
}

export interface Export {
  files: ZipFile[];
  report: ExportReport;
}

const enc = new TextEncoder();

/** Attributes holding one address, and srcset (several). url(…) in CSS is handled on its own. */
const ATTR = /(\s(?:href|src|poster|action|data)\s*=\s*)(["'])(.*?)\2/gi;
const SRCSET = /(\ssrcset\s*=\s*)(["'])(.*?)\2/gi;
const CSS_URL = /(url\(\s*)(["']?)([^"')]+)\2(\s*\))/gi;
/** Things a page loads (not links it offers), to report the ones that come from other servers. */
const LOADED = /<(?:img|source|video|audio|script|iframe|embed)\b[^>]*?\s(?:src|poster)\s*=\s*["']([^"']+)["']|<link\b[^>]*?\shref\s*=\s*["']([^"']+)["'][^>]*>|\ssrcset\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

const remoteURL = (u: string) => /^(https?:)?\/\//i.test(u.trim());

/**
 * One rendered page with its root-absolute addresses made relative. `depth` is how many folders
 * down the page sits in the export (0 for a lone page, 1 for a page of a site).
 */
export function relativize(html: string, depth: number, pages: string[], opts: ExportOptions = {}, broken: (href: string) => void = () => {}): string {
  const up = depth ? '../'.repeat(depth) : './';
  const fix = (raw: string): string => {
    const u = raw.trim();
    if (!u.startsWith('/') || u.startsWith('//')) return raw;
    const page = linkedPage(u);
    if (page && pages.includes(page)) {
      // /about, /about/, /about#x, /about/?q → about/ (or about/index.html) with the rest kept
      const rest = u.slice(page.length + 1);
      const m = /^\/?(?:index\.html)?([?#].*)?$/.exec(rest);
      if (m) return `${up}${page}/${opts.files ? 'index.html' : ''}${m[1] ?? ''}`;
      return `${up}${page}${rest}`;
    }
    if (page && page !== 'assets' && page !== 'kit') broken(u);
    return `${up}${u.slice(1)}`;
  };
  return html
    .replace(ATTR, (_a, pre, q, v) => `${pre}${q}${fix(v)}${q}`)
    .replace(SRCSET, (_a, pre, q, v: string) => `${pre}${q}${v.split(',').map((part) => part.replace(/^(\s*)(\S+)/, (_m, sp, u) => sp + fix(u))).join(',')}${q}`)
    .replace(CSS_URL, (_a, pre, q, v, post) => `${pre}${q}${fix(v)}${q}${post}`);
}

/** The addresses a page loads from other servers. */
export function remoteLoads(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(LOADED)) {
    const found = m[1] ?? m[2] ?? m[4];
    if (found && remoteURL(found)) out.add(found.trim());
    if (m[3]) for (const part of m[3].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u && remoteURL(u)) out.add(u);
    }
  }
  return [...out];
}

/** The files of one page: its index.html and its assets, under `prefix`. */
function pageFiles(ws: Workspace, name: string, prefix: string, depth: number, pages: string[], opts: ExportOptions, report: ExportReport, title = name) {
  const rendered = ws.page({ title });
  const html = relativize(opts.credit ? withCredit(rendered) : rendered, depth, pages, opts, (href) => report.broken.push({ page: name, href }));
  for (const url of remoteLoads(html)) report.remote.push({ page: name, url });
  const files: ZipFile[] = [{ path: `${prefix}index.html`, bytes: enc.encode(html) }];
  for (const f of ws.assets()) {
    const bytes = ws.store.readBytes(`assets/${f}`);
    if (bytes) files.push({ path: `${prefix}assets/${f}`, bytes });
  }
  return files;
}

/** The site kit's behaviours and their loader, which pages load from /kit/ (its styles are in each page's head). */
function kitFiles(dir: string): ZipFile[] {
  const scripts = kitList(dir).scripts;
  if (!scripts.length) return [];
  return [{ path: 'kit/loader.js', bytes: enc.encode(KIT_LOADER) }, ...scripts.map((n) => ({ path: `kit/scripts/${n}.js`, bytes: enc.encode(kitRead(dir, 'scripts', n) ?? '') }))];
}

/** Everything an export holds, in memory: a lone page at the root, or each page of a site in its own folder. */
export function exportFiles(dir: string, opts: ExportOptions = {}): Export {
  const report: ExportReport = { pages: [], files: 0, bytes: 0, broken: [], remote: [] };
  let files: ZipFile[];
  if (siteKind(dir) === 'page') {
    // a lone page; a page of a site keeps the site's theme, whose fonts come along in assets/
    const ws = new Workspace(dir, { site: siteOf(dir) });
    report.pages = ['index'];
    files = pageFiles(ws, dir.split(/[\\/]/).filter(Boolean).pop() ?? 'page', '', 0, [], opts, report);
    if (ws.siteHead()) {
      const site = new FolderStore(dirname(dir));
      for (const f of site.list('assets')) if (!files.some((x) => x.path === `assets/${f}`)) files.push({ path: `assets/${f}`, bytes: site.readBytes(`assets/${f}`)! });
    }
    if (ws.kitHead()) files.push(...kitFiles(dirname(dir)));
  } else {
    const pages = sitePages(dir);
    if (!pages.length) throw new Error('the site has no pages yet');
    report.pages = pages;
    const settings = readSite(dir);
    files = pages.flatMap((p) => pageFiles(pageWorkspace(dir, p), p, `${p}/`, 1, pages, opts, report, pageTitle(dir, p, settings)));
    // the site's own files (the shared theme's fonts), which the pages load from /assets/
    const site = new FolderStore(dir);
    for (const f of site.list('assets')) files.push({ path: `assets/${f}`, bytes: site.readBytes(`assets/${f}`)! });
    files.push(...kitFiles(dir));
    // the site's front door opens its home page (or its first), and pages/ lists them all
    const front = settings.home ?? pages[0];
    const to = `./${front}/${opts.files ? 'index.html' : ''}`;
    files.unshift({ path: 'index.html', bytes: enc.encode(`<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=${to}">\n<title>${front}</title>\n<a href="${to}">${front}</a>\n`) });
    // TYKERF's own pages (the list, the 404) say where TYKERF is; the site's pages only with the credit
    const by = { href: TYKERF_REPO, text: TYKERF_REPO.replace('https://', '') };
    files.push({ path: 'pages/index.html', bytes: enc.encode(relativize(siteIndex(dir, opts.credit ? by : undefined), 1, pages, opts)) });
    // 404.html: what web hosts (Cloudflare Pages, GitHub Pages, Netlify) serve for an address that isn't
    // there, at that address. Its links can't be relative to it, so a <base> sets where the site starts
    // (the public address's path, else the domain's root). Without it, Cloudflare Pages serves index.html
    // for every unknown address, and its redirect to the home page goes deeper on each hop.
    if (!opts.files) {
      let base = '/';
      try { if (opts.publicUrl) base = new URL(`${opts.publicUrl.replace(/\/+$/, '')}/`).pathname; } catch {}
      const missing = relativize(siteIndex(dir, by, 'This page isn\'t here'), 0, pages, opts)
        .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<base href="${base.replace(/"/g, '%22')}">\n<meta name="robots" content="noindex">`);
      files.push({ path: '404.html', bytes: enc.encode(missing) });
    }
    // the site's icon, which every page links to (/favicon.<ext>)
    const icon = siteIcon(dir);
    files.push({ path: icon.file, bytes: icon.bytes });
    if (opts.publicUrl) files.push({ path: 'sitemap.xml', bytes: enc.encode(siteMap(dir, opts.publicUrl)) });
  }
  // only the files some page uses (earlier crops and pictures of removed boxes stay behind)
  const html = files.filter((f) => f.path.endsWith('.html')).map((f) => new TextDecoder().decode(f.bytes)).join('\n');
  files = files.filter((f) => !/(^|\/)assets\//.test(f.path) || html.includes(f.path.split('/').pop()!));
  report.files = files.length;
  report.bytes = files.reduce((n, f) => n + f.bytes.length, 0);
  return { files, report };
}

/** Write an export into a folder (made if needed; existing files with the same names are replaced). */
export function exportToFolder(dir: string, out: string, opts: ExportOptions = {}): ExportReport {
  const { files, report } = exportFiles(dir, opts);
  for (const f of files) {
    const to = join(out, f.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, f.bytes);
  }
  return report;
}

/** An export as one .zip file. */
export function exportZip(dir: string, opts: ExportOptions = {}): { bytes: Uint8Array; report: ExportReport } {
  const { files, report } = exportFiles(dir, opts);
  return { bytes: zip(files), report };
}

/** The report as a few readable lines. */
export function describeReport(r: ExportReport): string {
  const lines = [`${r.pages.length} page${r.pages.length === 1 ? '' : 's'}, ${r.files} files, ${(r.bytes / 1024).toFixed(0)} KB`];
  if (r.broken.length) lines.push(`${r.broken.length} link${r.broken.length === 1 ? '' : 's'} to pages that don't exist: ${r.broken.map((b) => `${b.page} → ${b.href}`).join(', ')}`);
  if (r.remote.length) {
    const hosts = [...new Set(r.remote.map((x) => { try { return new URL(x.url, 'https://x').host; } catch { return x.url; } }))];
    lines.push(`${r.remote.length} image${r.remote.length === 1 ? '' : 's'}, fonts or files still load from other servers (${hosts.join(', ')}); copy the ones you may use into the page before publishing`);
  }
  return lines.join('\n');
}
