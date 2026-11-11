// The whole site's check (src/check-site.ts): what to fix before publishing, every page at once, for the site
// manager, Kaity (check_site) and an export's report.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSite, sayFindings } from '../src/check-site.js';
import { describeReport, exportFiles } from '../src/export.js';
import { kitWrite } from '../src/kit.js';
import { newSitePage, pageWorkspace, setLang } from '../src/site.js';

/** A site with each problem the check looks for, once. */
function site() {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-check-site-'));
  const home = newSitePage(dir, 'home', 'blank', 'studio');
  const about = newSitePage(dir, 'about', 'blank', 'studio');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'pic.png'), 'x');
  writeFileSync(join(dir, 'assets', 'f.woff2'), 'x');
  home.setContent('text', [
    '<h1>Our bakery</h1>',
    '<p><a href="/gone/">Gone</a></p>', // a page the site doesn't have
    '<img src="assets/nothere.png" alt="A loaf">', // a file the page doesn't have
    '<img src="/assets/pic.png">', // no alt
    '<a href="/about/"><img src="/assets/pic.png" alt=""> About us</a>', // alt="" in a link with words: fine
    '<img src="/assets/pic.png" alt="" role="presentation">', // decoration: fine
    '<img src="https://example.com/x.png" alt="Remote">', // from another server
  ].join('\n'), 'user');
  about.setContent('text', `<h1>${'A very long title that goes on and on about what this page holds, far too long'}</h1>`, 'user');
  newSitePage(dir, 'lost', 'blank', 'studio').setContent('text', '<p>No heading here, and no page links to it.</p>', 'user');
  kitWrite(dir, 'blocks', 'banner', '<div><img src="assets/logo.png" alt="Logo"></div>'); // a page's file in a shared block
  kitWrite(dir, 'blocks', 'text', pageWorkspace(dir, 'lost').ownContent('text')!); // lost's text box: a copy of it
  kitWrite(dir, 'fonts', 'fonts', JSON.stringify({ Diavlo: { files: [{ file: 'f.woff2', weight: '400', style: 'normal' }] } })); // no licence
  return dir;
}

describe("the site's check", () => {
  it('finds each problem, with the tool that fixes it', () => {
    const dir = site();
    const findings = checkSite(dir);
    const of = (kind: string) => findings.filter((f) => f.kind === kind);
    expect(new Set(findings.map((f) => f.kind))).toEqual(new Set(['link', 'file', 'orphan', 'title', 'shared-file', 'copy', 'font', 'alt', 'lang', 'remote']));
    expect(of('link')).toEqual([expect.objectContaining({ page: 'home', box: 'text', detail: 'the link /gone/ goes to "gone", a page the site doesn\'t have' })]);
    expect(of('file').map((f) => f.detail)).toContain('assets/nothere.png is not one of the files, so it shows broken');
    expect(of('alt')).toEqual([expect.objectContaining({ page: 'home', box: 'text', detail: 'a picture (/assets/pic.png) has no text alternative' })]);
    expect(of('remote')[0]).toMatchObject({ page: 'home', detail: expect.stringContaining('https://example.com/x.png') });
    expect(of('orphan').map((f) => f.page)).toEqual(['lost']); // home is the home page; about is linked from home
    expect(of('title').map((f) => [f.page, f.detail])).toEqual([
      ['about', expect.stringMatching(/^its title is 7\d characters/)],
      ['lost', 'it has no title and no heading: its name, "lost", stands in'],
    ]);
    expect(of('shared-file')[0]).toMatchObject({ detail: expect.stringContaining('the shared block banner uses assets/logo.png'), fix: 'add_file to the site, and write /assets/logo.png in the block' });
    expect(of('copy')).toEqual([expect.objectContaining({ page: 'lost', box: 'text', fix: 'link_block text text, so it follows the block' })]);
    expect(of('font')[0].detail).toBe('the font "Diavlo" has no licence noted');
    expect(of('lang')[0].fix).toMatch(/set_site lang/);
    // once the language is set, even to English, it is no finding
    setLang(dir, 'es');
    expect(checkSite(dir).some((f) => f.kind === 'lang')).toBe(false);
  });

  it('is told counts first, then by kind; Kaity has it, and an export reports it', async () => {
    const dir = site();
    const text = sayFindings(checkSite(dir));
    expect(text).toMatch(/^\d+ things to look at: 1 links to pages the site doesn't have, /);
    expect(text).toContain('\n\nlinks to pages the site doesn\'t have (1):\n- home/text: the link /gone/ goes to "gone", a page the site doesn\'t have → point it at one of the site\'s pages');
    const { openTools } = await import('../src/editor/tools-client.js');
    const run = await openTools(pageWorkspace(dir, 'home'), '', dir);
    expect((await run.call('check_site', {})).text).toBe(text);
    await run.close();
    const { report } = exportFiles(dir);
    expect(report.check).toMatchObject({ link: 1, alt: 1, lang: 1, orphan: 1 });
    expect(describeReport(report)).toMatch(/the site's check: 1 links to pages the site doesn't have, .* \(check_site, or Check the site in the site manager\)/);
  });
});
