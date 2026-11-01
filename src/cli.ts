// Small CLI around the library.
//
//   npx tsx src/cli.ts outline  "<postfix>"           parse + print outline
//   npx tsx src/cli.ts normalize "<postfix>"          print canonical form
//   npx tsx src/cli.ts render   <workspace-dir>        write <dir>/out/index.html (a site: every page's)
//   npx tsx src/cli.ts export   <page-or-site-dir> <out-dir> [--zip] [--files]   plain files for any web host
//   npx tsx src/cli.ts optimize <workspace-dir> <width> [--write]
//   npx tsx src/cli.ts import   <url> <site-or-page-dir> [--structure-only] [--name <page>]   a copy as a page of the site
//   npx tsx src/cli.ts new      <site-dir> [layout] [--theme <name>] [--name <page>]   a page from a layout (default: blank);
//                                                       a new or empty folder becomes a site with it as its home page
//   npx tsx src/cli.ts layouts                              list layouts, themes and components

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { assertValid } from './model.js';
import { normalize, outline, parse, serialize } from './notation.js';
import { optimize } from './shape.js';
import { siteKind, siteOf, sitePages } from './site.js';
import { Workspace } from './workspace.js';

const [cmd, arg, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'outline': {
    const layout = assertValid({ root: parse(arg), overlays: [] });
    console.log(outline(layout));
    break;
  }
  case 'normalize':
    console.log(serialize(normalize(parse(arg))));
    break;
  case 'render': {
    const dir = resolve(arg);
    // a site renders each of its pages into the page's own out/
    const pages = siteKind(dir) === 'site' ? sitePages(dir).map((p) => join(dir, p)) : [dir];
    for (const p of pages) console.log(new Workspace(p, { site: siteOf(p) }).render());
    break;
  }
  case 'export': {
    const { describeReport, exportToFolder, exportZip } = await import('./export.js');
    const out = rest.find((r) => !r.startsWith('--'));
    if (!arg || !out) {
      console.error('usage: export <page-or-site-dir> <out-dir | out.zip> [--zip] [--files]');
      process.exit(1);
    }
    // with the site's public address (TYKERF_PUBLIC_URL), the export has a sitemap.xml
    const opts = { files: rest.includes('--files'), publicUrl: process.env.TYKERF_PUBLIC_URL?.trim() || null };
    if (rest.includes('--zip') || out.endsWith('.zip')) {
      const { writeFileSync } = await import('node:fs');
      const to = resolve(out.endsWith('.zip') ? out : `${out}.zip`);
      const { bytes, report } = exportZip(resolve(arg), opts);
      writeFileSync(to, bytes);
      console.log(`exported ${resolve(arg)} -> ${to}\n${describeReport(report)}`);
    } else {
      const report = exportToFolder(resolve(arg), resolve(out), opts);
      console.log(`exported ${resolve(arg)} -> ${resolve(out)}\n${describeReport(report)}`);
    }
    break;
  }
  case 'optimize': {
    const ws = new Workspace(resolve(arg));
    const r = optimize(ws.load(), Number(rest[0]));
    console.log(`before ${r.before.cost.toFixed(0)}  after ${r.after.cost.toFixed(0)}  (height ${r.before.height.toFixed(0)} -> ${r.after.height.toFixed(0)})`);
    console.log(r.changes.join('\n') || 'no changes');
    if (rest.includes('--write')) ws.save(r.layout, `optimize ${rest[0]}`);
    break;
  }
  case 'import': {
    const { importPage, writeWorkspace } = await import('./importer.js');
    const { HOME_PAGE, freePageName, setHome } = await import('./site.js');
    const where = resolve(rest[0] ?? '');
    if (!arg || !rest[0]) {
      console.error('usage: import <url> <site-or-page-dir> [--structure-only] [--name <page>]');
      process.exit(1);
    }
    const wish = rest.indexOf('--name') >= 0 ? rest[rest.indexOf('--name') + 1] : undefined;
    let kind: 'page' | 'site';
    try {
      kind = siteKind(where);
    } catch (e) {
      console.error(`${(e as Error).message}. Give a site, one of its pages, or a new or empty folder for the copy`);
      process.exit(1);
    }
    // a page is replaced by the copy; a site gets it as a new page (its home page, in a new or empty folder)
    const first = kind === 'site' && !sitePages(where).length;
    const dir = kind === 'page' ? where : join(where, freePageName(where, wish ?? (first ? HOME_PAGE : URL.parse(arg)?.hostname.replace(/^www\./, '') ?? 'copy')));
    const r = await importPage(arg, { structureOnly: rest.includes('--structure-only') });
    writeWorkspace(dir, r, arg);
    if (first) setHome(where, basename(dir));
    console.log(`imported ${arg} -> ${dir}`);
    console.log(`${r.stats.boxes} boxes, ${r.stats.operators} rows/columns, depth ${r.stats.depth}, ${r.stats.rules} responsive rules`);
    console.log(`${Object.keys(r.files).length} images and fonts copied into assets/` + (r.remote.length ? `; ${r.remote.length} files still load from other servers` : ''));
    console.log('\nThe copy includes the site\'s text, images and design, which usually belong to someone else. Use it to');
    console.log('rebuild your own site, or to study and prototype; publish it only with the owner\'s permission.');
    break;
  }
  case 'new': {
    const { DEFAULT_THEME } = await import('./library.js');
    const { HOME_PAGE, addSitePage, freePageName, newSitePage } = await import('./site.js');
    if (!arg) {
      console.error('usage: new <site-dir> [layout] [--theme <name>] [--name <page>]');
      process.exit(1);
    }
    const option = (o: string) => (rest.indexOf(o) >= 0 ? rest[rest.indexOf(o) + 1] : undefined);
    const asked = option('--theme');
    const wish = option('--name');
    const layout = rest.find((r, i) => !r.startsWith('--') && !['--theme', '--name'].includes(rest[i - 1])) ?? 'blank';
    const dir = resolve(arg);
    // an empty or new folder becomes a site, with the page as its home (folders count too: a site may hold only its pages)
    if (!existsSync(dir) || !readdirSync(dir).some((f) => !f.startsWith('.'))) {
      const theme = asked ?? DEFAULT_THEME;
      const name = freePageName(dir, wish ?? HOME_PAGE);
      newSitePage(dir, name, layout, theme);
      console.log(`new site ${dir} with its home page "${name}" from the "${layout}" layout with the "${theme}" theme (npm start -- ${arg})`);
      break;
    }
    let kind: 'page' | 'site';
    try {
      kind = siteKind(dir);
    } catch (e) {
      console.error(`${(e as Error).message}. Give a new or empty folder for the page, such as ${join(dir, layout)}`);
      process.exit(1);
    }
    if (kind === 'page') {
      console.error(`${dir} is a page; a new page there would replace it. Give its site${siteOf(dir) ? ` (${dirname(dir)})` : ''}, or a new or empty folder for a new site`);
      process.exit(1);
    }
    // a site (a folder of pages): not an error; the page is added to it, beside the others
    const name = freePageName(dir, wish ?? layout);
    const { ownValues } = addSitePage(dir, name, layout, asked);
    console.warn(`warning: ${dir} is a site with ${sitePages(dir).length - 1} pages, so the new page was added to it as "${name}"${wish && wish !== name ? ` ("${wish}" was taken)` : ''}, not written over the site folder`);
    if (ownValues) console.warn(`warning: the site shares one theme; the "${asked}" theme was given to "${name}" as its own values, so the other pages keep their look`);
    console.log(`new page ${join(dir, name)} from the "${layout}" layout${asked ? ` with the "${asked}" theme` : ''}`);
    break;
  }
  case 'layouts': {
    const { components, pageLayouts, themes } = await import('./library.js');
    console.log('Layouts (npm start -- <folder> --layout <name>):');
    for (const p of pageLayouts()) console.log(`  ${p.name.padEnd(14)} ${p.description}`);
    console.log('\nThemes (--theme <name>; the Page tab changes them later):');
    for (const t of themes()) console.log(`  ${t.name.padEnd(14)} ${t.description}`);
    console.log('\nComponents (an empty box: Text tab → Use a component):');
    for (const c of components()) console.log(`  ${c.name.padEnd(14)} ${c.description}`);
    break;
  }
  default:
    console.error('commands: outline "<postfix>" | normalize "<postfix>" | render <dir> | export <dir> <out> [--zip] [--files] | optimize <dir> <width> [--write] | import <url> <dir> [--structure-only] | new <dir> [layout] [--theme <name>] | layouts');
    process.exit(1);
}
