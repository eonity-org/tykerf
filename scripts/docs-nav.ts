// The header and footer of every Markdown page: the TYKERF logo and where the page sits (a breadcrumb up to
// its index), then at the end the previous and next pages of its guide, its index, and the project's links.
// They sit between <!-- tykerf:header --> and <!-- tykerf:footer --> markers, and this script writes them:
//
//   npm run docs:nav            rewrite them
//   npm run docs:nav -- --check say which pages are out of date (test/docs.test.ts runs it)
//
// A guide's order is the order of the links in its index's table. CLAUDE.md is left out: it is read by AI
// coding assistants, not people browsing the docs.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/eonity-org/tykerf';

/** A place in the docs: a file, and the name it goes by in a breadcrumb. */
interface Place {
  file: string;
  name: string;
}

interface Guide {
  index: Place;
  /** The places above the index (TYKERF, Documentation…). */
  up: Place[];
  /** The pages, in reading order; filled from the index's table. */
  pages?: string[];
}

const TYKERF: Place = { file: 'README.md', name: 'TYKERF' };
const DOCS: Place = { file: 'docs/README.md', name: 'Documentation' };
const USER: Guide = { index: { file: 'docs/user-guide/en/README.md', name: 'User guide' }, up: [TYKERF, DOCS] };
const DEV: Guide = { index: { file: 'docs/developer-guide/en/README.md', name: 'Developer guide' }, up: [TYKERF, DOCS] };
const ROADMAP: Place = { file: 'ROADMAP.md', name: 'Roadmap' };

/** Every page that gets a header and footer, with the guide it belongs to (or the places above it). */
function pages(): { file: string; guide?: Guide; up: Place[] }[] {
  const out: { file: string; guide?: Guide; up: Place[] }[] = [];
  for (const g of [USER, DEV]) {
    g.pages = order(g.index.file);
    out.push({ file: g.index.file, guide: g, up: g.up });
    for (const p of g.pages) out.push({ file: p, guide: g, up: [...g.up, g.index] });
  }
  out.push(
    { file: 'README.md', up: [] },
    { file: 'docs/README.md', up: [TYKERF] },
    { file: 'docs/user-guide/README.md', up: [TYKERF, DOCS] },
    { file: 'docs/developer-guide/README.md', up: [TYKERF, DOCS] },
    { file: 'docs/slicing-notation.md', up: [TYKERF, DOCS] },
    { file: 'docs/plans/0.2-finish.md', up: [TYKERF, ROADMAP] },
    { file: 'docs/plans/site-manager.md', up: [TYKERF, ROADMAP] },
    { file: 'docs/plans/templates-redesign.md', up: [TYKERF, ROADMAP] },
    ...['DEPLOY.md', 'ROADMAP.md', 'BRAND.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'Other_Layouts/README.md'].map((file) => ({ file, up: [TYKERF] })),
  );
  return out;
}

/** The pages an index's table links to, in order (only Markdown pages next to it). */
function order(index: string): string[] {
  const text = strip(readFileSync(join(ROOT, index), 'utf8'));
  const dir = posix.dirname(index);
  const seen: string[] = [];
  for (const line of text.split('\n').filter((l) => l.startsWith('|'))) {
    const m = /^\|\s*\[[^\]]+\]\(([\w-]+\.md)\)/.exec(line);
    if (m) seen.push(posix.join(dir, m[1]));
  }
  return seen;
}

const HEADER = /^<!-- tykerf:header -->[\s\S]*?<!-- \/tykerf:header -->\n\n?/;
const FOOTER = /\n*<!-- tykerf:footer -->[\s\S]*?<!-- \/tykerf:footer -->\n?$/;
const strip = (text: string) => text.replace(HEADER, '').replace(FOOTER, '\n');

/** A page's title: its first heading. */
function title(file: string): string {
  const text = strip(readFileSync(join(ROOT, file), 'utf8'));
  return (/^#\s+(.+)$/m.exec(text)?.[1] ?? posix.basename(file, '.md')).replace(/[*_`]/g, '').trim();
}

/** A link from one file to another, relative, as Markdown wants it. */
const rel = (from: string, to: string) => relative(dirname(join(ROOT, from)), join(ROOT, to)).split('\\').join('/') || posix.basename(to);

function header(file: string, up: Place[]): string {
  // the logo with a wider margin: some Markdown viewers round every image (Markdown Preview on the Mac: 8px,
  // and it ignores style="border-radius:0"), which at this size cut the f's hook off; with the margin the
  // corners are empty. 22px high draws the logo at the size of the plain file at 20px
  const logo = `[<img src="${rel(file, 'src/editor/public/brand/tykerf-logo-docs.svg')}" alt="TYKERF" height="22">](${rel(file, 'README.md')})`;
  const crumbs = up.filter((p) => p !== TYKERF).map((p) => `[${p.name}](${rel(file, p.file)})`);
  // a blank line first (Markdown drops empty lines, not an empty paragraph), so the logo doesn't touch the top
  return `<!-- tykerf:header -->\n&nbsp;\n\n${[logo, ...crumbs, `**${title(file)}**`].join(' › ')}\n<!-- /tykerf:header -->\n\n`;
}

function footer(file: string, guide: Guide | undefined, up: Place[]): string {
  const lines: string[] = [];
  if (guide?.pages) {
    const at = guide.pages.indexOf(file); // -1: the index itself
    const prev = at === -1 ? null : at === 0 ? guide.index.file : guide.pages[at - 1];
    const next = at + 1 < guide.pages.length ? guide.pages[at + 1] : null;
    lines.push([
      prev ? `← [${prev === guide.index.file ? guide.index.name : title(prev)}](${rel(file, prev)})` : '',
      at === -1 ? '' : `[${guide.index.name} index](${rel(file, guide.index.file)})`,
      next ? `[${title(next)}](${rel(file, next)}) →` : '',
    ].filter(Boolean).join(' · '));
  } else if (up.length && up.at(-1) !== TYKERF) {
    // back up to where it sits (TYKERF itself is on the next line anyway)
    lines.push(`↑ [${up.at(-1)!.name}](${rel(file, up.at(-1)!.file)})`);
  }
  lines.push(`[TYKERF](${rel(file, 'README.md')}) · [Documentation](${rel(file, DOCS.file)}) · [GitHub](${REPO}) · Apache-2.0 · an [eonity](https://eonity.org) project`);
  return `\n\n<!-- tykerf:footer -->\n---\n\n${lines.join('\n\n')}\n<!-- /tykerf:footer -->\n`;
}

/** Each page with its header and footer as they should be. README.md has its own logo: it only gets the footer. */
export function docsNav(): { file: string; before: string; after: string }[] {
  return pages().map(({ file, guide, up }) => {
    const before = readFileSync(join(ROOT, file), 'utf8');
    const body = strip(before).replace(/\n+$/, '');
    const after = (file === 'README.md' ? '' : header(file, up)) + body + footer(file, guide, up);
    return { file, before, after };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stale = docsNav().filter((p) => p.before !== p.after);
  if (process.argv.includes('--check')) {
    for (const p of stale) console.log(`out of date: ${p.file}`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const p of stale) writeFileSync(join(ROOT, p.file), p.after);
  console.log(`${stale.length} page${stale.length === 1 ? '' : 's'} updated`);
}
