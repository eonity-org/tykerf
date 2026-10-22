// Small CLI around the library.
//
//   npx tsx src/cli.ts outline  "<postfix>"           parse + print outline
//   npx tsx src/cli.ts normalize "<postfix>"          print canonical form
//   npx tsx src/cli.ts render   <workspace-dir>        write <dir>/out/index.html (a site: every page's)
//   npx tsx src/cli.ts export   <page-or-site-dir> <out-dir> [--zip] [--files]   plain files for any web host
//   npx tsx src/cli.ts optimize <workspace-dir> <width> [--write]
//   npx tsx src/cli.ts import   <url> <workspace-dir> [--structure-only]
//   npx tsx src/cli.ts new      <workspace-dir> [layout] [--theme <name>]   start a page from a layout (default: blank)
//   npx tsx src/cli.ts layouts                              list layouts, themes and components

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
    const { createPage } = await import('./library.js');
    if (!arg) {
      console.error('usage: new <workspace-dir> [layout] [--theme <name>]');
      process.exit(1);
    }
    const ws = new Workspace(resolve(arg));
    if (ws.store.list('').some((f) => !f.startsWith('.'))) {
      console.error(`${ws.store.location} is not empty; a new page needs a new or empty folder`);
      process.exit(1);
    }
    const themeAt = rest.indexOf('--theme');
    const { DEFAULT_THEME } = await import('./library.js');
    const theme = themeAt >= 0 ? rest[themeAt + 1] : DEFAULT_THEME;
    const layout = rest.find((r, i) => !r.startsWith('--') && rest[i - 1] !== '--theme') ?? 'blank';
    createPage(ws, layout, theme);
    console.log(`new page in ${ws.store.location} from the "${layout}" layout with the "${theme}" theme`);
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
