// The docs: every page has its header and footer as scripts/docs-nav.ts writes them, and every link between
// pages (and to an image or a #section) leads somewhere.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsNav } from '../scripts/docs-nav.js';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);

/** A heading's #anchor, the way GitHub makes it. */
const slug = (h: string) => h.trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^\w\- ]/g, '').replace(/ /g, '-');
const anchors = (file: string) => new Set([...readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').matchAll(/^#+\s+(.*)$/gm)].map((m) => slug(m[1])));

describe('the docs', () => {
  it('give every page its header and footer (npm run docs:nav writes them)', () => {
    const stale = docsNav().filter((p) => p.before !== p.after).map((p) => p.file);
    expect(stale, 'run npm run docs:nav').toEqual([]);
    // every Markdown file but CLAUDE.md (for AI coding assistants) has them
    const covered = new Set(docsNav().map((p) => p.file));
    expect(files.filter((f) => !covered.has(f) && f !== 'CLAUDE.md' && !f.startsWith('node_modules/'))).toEqual([]);
  });

  it('link only to files and sections that exist', () => {
    const broken: string[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)|<img src="([^"]+)"/g)) {
        const link = m[1] ?? m[2];
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [path, anchor] = link.split('#');
        const target = path ? normalize(join(dirname(file), path)) : file;
        if (!existsSync(target)) broken.push(`${file}: ${link}`);
        else if (anchor && target.endsWith('.md') && !anchors(target).has(anchor)) broken.push(`${file}: ${link} (no such section)`);
      }
    }
    expect(broken).toEqual([]);
  });
});
