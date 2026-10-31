// Small CLI around the library.
//
//   npx tsx src/cli.ts outline  "<postfix>"           parse + print outline
//   npx tsx src/cli.ts normalize "<postfix>"          print canonical form
//   npx tsx src/cli.ts render   <workspace-dir>        write <dir>/out/index.html (a site: every page's)
//   npx tsx src/cli.ts export   <page-or-site-dir> <out-dir> [--zip] [--files]   plain files for any web host
//   npx tsx src/cli.ts optimize <workspace-dir> <width> [--write]
//   npx tsx src/cli.ts import   <url> <workspace-dir> [--structure-only]
//   npx tsx src/cli.ts new      <workspace-dir> [layout] [--theme <name>] [--name <page>]   start a page from a layout (default: blank);
//                                                       on a site, the page is added to it (a warning, not an error)
//   npx tsx src/cli.ts layouts                              list layouts, themes and components

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    const dir = resolve(rest[0] ?? '');
    if (!arg || !rest[0]) {
      console.error('usage: import <url> <workspace-dir> [--structure-only]');
      process.exit(1);
    }
    const r = await importPage(arg, { structureOnly: rest.includes('--structure-only') });
    writeWorkspace(dir, r, arg);
    console.log(`imported ${arg} -> ${dir}`);
    console.log(`${r.stats.boxes} boxes, ${r.stats.operators} rows/columns, depth ${r.stats.depth}, ${r.stats.rules} responsive rules`);
    console.log(`${Object.keys(r.files).length} images and fonts copied into assets/` + (r.remote.length ? `; ${r.remote.length} files still load from other servers` : ''));
    console.log('\nThe copy includes the site\'s text, images and design, which usually belong to someone else. Use it to');
    console.log('rebuild your own site, or to study and prototype; publish it only with the owner\'s permission.');
    break;
  }
  case 'new': {
    const { DEFAULT_THEME, createPage } = await import('./library.js');
    if (!arg) {
      console.error('usage: new <workspace-dir> [layout] [--theme <name>] [--name <page>]');
      process.exit(1);
    }
    const option = (o: string) => (rest.indexOf(o) >= 0 ? rest[rest.indexOf(o) + 1] : undefined);
    const asked = option('--theme');
    const layout = rest.find((r, i) => !r.startsWith('--') && !['--theme', '--name'].includes(rest[i - 1])) ?? 'blank';
    const dir = resolve(arg);
    const ws = new Workspace(dir);
    // an empty or new folder: the page goes in it (folders count too: a site may hold only its pages)
    if (!existsSync(dir) || !readdirSync(dir).some((f) => !f.startsWith('.'))) {
      const theme = asked ?? DEFAULT_THEME;
      createPage(ws, layout, theme);
      console.log(`new page in ${ws.store.location} from the "${layout}" layout with the "${theme}" theme`);
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
      console.error(`${dir} is already a page; a new page there would replace it. Give a new or empty folder, or change this page in the editor (npm start -- ${arg})`);
      process.exit(1);
    }
    // a site (a folder of pages): not an error; the page is added to it, beside the others
    const { addSitePage, freePageName } = await import('./site.js');
    const wish = option('--name');
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
