// The site's screens in the v3 editor (site.js shows them beside the docked sidebar). Each keeps what the site
// manager does and shows it as the redesign asks: the important things large, a fix next to each problem, Kaity's
// part said next to whatever hands her work. Each screen is { title(), render(main, ctx), onAi?(message) }, and
// draws itself again from the server on every render.

import { markdown } from '../markdown.js';
import { $, esc, failed, hardToReach, kaityMark, keptTwice, plainLabel, request, size, t, toast, when } from './common.js';

const edit = (page, q = '') => `/_tykerf/edit/${encodeURIComponent(page)}/${q}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (xs) => xs.map((x) => `<b>${esc(x)}</b>`).join(', ');

/** Ask Kaity about the whole site, then show her at work (the Kaity screen). */
async function askKaity(prompt, ctx) {
  try {
    await request('/_tykerf/site/ask', { prompt });
    ctx.go('kaity');
  } catch (e) {
    failed(e);
  }
}

/** A file read as base64 (for the icon and uploads). */
const base64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => fail(r.error);
  r.readAsDataURL(file);
});

// ---------- every open task on the site (R12) ----------

/** The kinds of the site's check that become tasks on a page's box: Kaity fixes them there. */
const TASK_KINDS = new Set(['alt', 'link', 'copy']);

/** "3 open tasks and questions on 2 pages.", singular where it is one. */
const lead = (n, m) => t('{things} on {pages}.', {
  things: n === 1 ? t('1 open task or question') : t('{n} open tasks and questions', { n }),
  pages: m === 1 ? t('1 page') : t('{n} pages', { n: m }),
});

const tasksScreen = {
  title: () => t('Tasks for Kaity'),
  async render(main, ctx) {
    const [r, check] = await Promise.all([request('/_tykerf/site/tasks'), request('/_tykerf/site/check').catch(() => null)]);
    const total = r.total, pages = r.pages.filter((x) => x.tasks.length || x.run);
    const working = r.queue[0] ?? r.pages.find((x) => x.run?.running)?.page ?? null;
    const fixes = (check?.findings ?? []).filter((f) => f.page && f.box && TASK_KINDS.has(f.kind));
    const row = (x) => `<li class="trow"><span class="num${x.kind === 'question' ? ' q' : ''}">${x.kind === 'question' ? esc(t('Question')) : x.n}</span>
      <span class="twhere"><b>${esc(x.block)}</b> ${esc(plainLabel(x.label))}</span><span class="ttext">${esc(x.text)}</span></li>`;
    main.innerHTML = `
      <h1>${esc(t('Every open task on the site'))}</h1>
      <p class="lead">${esc(total ? lead(total, pages.filter((x) => x.tasks.length).length) : t('No open tasks. Open a page, click anything on it and say what should change.'))}</p>
      <div class="give">
        ${working
          ? `<p class="working">${kaityMark(true)} ${esc(t('Kaity is working on {page}.', { page: working }))}</p><button type="button" class="btn" data-t="stop">${esc(t('Stop Kaity'))}</button>`
          : `<button type="button" class="btn main big" data-t="all" ${total ? '' : 'disabled'}>${esc(t('Give Kaity everything'))}</button>`}
        <p class="scope">${esc(t('She works page by page, one task at a time, and only in the box each task points at. You review what she did on each page.'))}</p>
      </div>
      ${fixes.length ? `<div class="strip"><p>${esc(fixes.length === 1 ? t('Check the site found 1 thing on a page that Kaity can fix.') : t('Check the site found {n} things on the pages that Kaity can fix.', { n: fixes.length }))}</p><button type="button" class="btn" data-t="fixes">${esc(t('Add them as tasks'))}</button></div>` : ''}
      ${pages.map((x) => `<section class="group" data-page="${esc(x.page)}">
        <header><h2>${esc(x.page)}</h2><span class="addr">/${esc(x.page)}/</span>
          ${x.run?.running ? `<span class="state now">${esc(t('Kaity is working here'))}</span>` : x.run ? `<span class="state done">${esc(t('Kaity finished here: review it on the page'))}</span>` : ''}
          <span class="spacer"></span>
          <a class="btn" href="${edit(x.page)}">${esc(t('Open the page'))}</a>
          ${x.tasks.length ? `<button type="button" class="btn" data-t="page" ${working ? 'disabled' : ''}>${esc(t('Give Kaity this page'))}</button>` : ''}
        </header>
        <ul class="trows">${x.tasks.map(row).join('')}</ul>
      </section>`).join('')}`;
    main.onclick = async (e) => {
      const act = e.target.closest('[data-t]')?.dataset.t;
      if (!act) return;
      try {
        if (act === 'all') await request('/_tykerf/site/tasks/give', {});
        if (act === 'stop') await request('/_tykerf/site/tasks/stop', {});
        if (act === 'page') await request('/_tykerf/site/tasks/give', { pages: [e.target.closest('[data-page]').dataset.page] });
        if (act === 'fixes') {
          for (const f of fixes) await request(`/${encodeURIComponent(f.page)}/_tykerf/tasks/add`, { block: f.box, text: `${cap(f.detail)}.` });
          toast(t('{n} tasks added', { n: fixes.length }));
        }
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
  },
};

// ---------- shared blocks and the rest of the site kit (R11) ----------

const KIT_TABS = [
  ['blocks', () => t('Shared blocks')], ['styles', () => t('Styles')], ['scripts', () => t('Behaviours')], ['types', () => t('Box types')], ['tags', () => t('Tags')], ['fonts', () => t('Fonts')],
];
let kitTab = 'blocks', kitOpen = null; // the tab, and the kit file open in it ({ kind, name, text, isNew })

const sharedScreen = {
  title: () => t('Shared blocks'),
  async render(main, ctx) {
    const kit = await request('/_tykerf/site/kit');
    const count = (k) => (k === 'tags' ? (kit.files.tags ? 1 : 0) : k === 'fonts' ? Object.keys(kit.fonts ?? {}).length : kit.files[k]?.length ?? 0);
    const tabs = `<div class="tabs" role="tablist">${KIT_TABS.map(([k, l]) => `<button type="button" role="tab" data-kit-tab="${k}" aria-selected="${k === kitTab}">${esc(l())} <span class="count">${count(k)}</span></button>`).join('')}</div>`;
    if (kitTab === 'fonts') return renderFonts(main, ctx, kit, tabs);
    if (kitTab !== 'blocks') return renderKitFiles(main, ctx, kit, tabs);
    // each shared block's slots (the parts each page fills itself)
    const slots = Object.fromEntries(await Promise.all(kit.files.blocks.map(async (b) => {
      const text = (await request(`/_tykerf/site/kit/file?kind=blocks&name=${encodeURIComponent(b)}`).catch(() => ({ text: '' }))).text ?? '';
      return [b, [...text.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1])];
    })));
    const could = kit.identical ?? [];
    main.innerHTML = `
      <h1>${esc(t('Shared blocks'))}</h1>
      <p class="lead">${esc(t('A shared block is the same on every page that shows it: one change reaches them all. Head code, the icon and the language have their own place in the sidebar.'))}</p>
      ${tabs}
      ${could.length ? `<section class="suggest">
        <h2>${esc(could.length === 1 ? t('1 box could be shared') : t('{n} boxes could be shared', { n: could.length }))}</h2>
        <p>${esc(t('They are the same on several pages. Shared, one change reaches every page that shows them.'))}</p>
        <ul class="share-list">${could.map((c) => `<li><span class="bname">${esc(c.box)}</span><span class="on">${t('on {pages}', { pages: list(c.pages) })}</span><button type="button" class="btn primary small" data-share="${esc(c.box)}">${esc(t('Share {box}', { box: c.box }))}</button></li>`).join('')}</ul>
        <div class="row">${could.length > 1 ? `<button type="button" class="btn primary" data-k="share-all">${esc(t('Share all {n}', { n: could.length }))}</button>` : ''}<button type="button" class="btn" data-k="kaity-share">${esc(t('Let Kaity decide which'))}</button></div>
      </section>` : ''}
      <h2>${esc(t('Shared now'))}</h2>
      ${kit.files.blocks.length ? `<div class="bcards">${kit.files.blocks.map((b) => {
        const where = kit.where?.[b] ?? {};
        const pages = Object.keys(where);
        const first = pages[0];
        const s = slots[b] ?? [];
        return `<article class="bcard">
          <h3>${esc(b)}</h3>
          <p>${pages.length ? (pages.length === 1 ? t('1 page shows it: {pages}', { pages: list(pages) }) : t('{n} pages show it: {pages}', { n: pages.length, pages: list(pages) })) : esc(t('No page shows it yet.'))}</p>
          <p class="note">${esc(s.length ? (s.length === 1 ? t('1 slot each page fills itself: {slots}', { slots: s.join(', ') }) : t('{n} slots each page fills itself: {slots}', { n: s.length, slots: s.join(', ') })) : t('No slots: it is the same everywhere.'))}</p>
          ${first ? `<div class="row"><a class="btn small" href="${edit(first, `?show=${encodeURIComponent(where[first][0] ?? b)}`)}">${esc(t('Open it on {page}', { page: first }))}</a><a class="btn small" href="${edit(first, `?task=${encodeURIComponent(where[first][0] ?? b)}`)}">${esc(t('Leave a task'))}</a></div>` : ''}
        </article>`;
      }).join('')}</div>` : `<p class="empty">${esc(t('No shared blocks yet.'))}</p>`}`;
    main.onclick = async (e) => {
      const tab = e.target.closest('[data-kit-tab]')?.dataset.kitTab;
      if (tab) return (kitTab = tab), (kitOpen = null), sharedScreen.render(main, ctx);
      const box = e.target.closest('[data-share]')?.dataset.share;
      const act = e.target.closest('[data-k]')?.dataset.k;
      try {
        if (box) await request('/_tykerf/site/kit/share', { box });
        if (act === 'share-all') for (const c of could) await request('/_tykerf/site/kit/share', { box: c.box });
        if (act === 'kaity-share') return askKaity(`These boxes are the same on several pages: ${could.map((c) => `${c.box} (on ${c.pages.join(', ')})`).join('; ')}. Decide which should be shared blocks of the site, share those (share_block, link_block), and say why for each.`, ctx);
        if (box || act === 'share-all') toast(t('Shared: one change now reaches every page that shows it'));
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
  },
};

/** The site's own fonts (kit/fonts.json): each with its files, weights and licence, and a form for one more. */
function renderFonts(main, ctx, kit, tabs) {
  const fonts = Object.entries(kit.fonts ?? {});
  const say = ([family, f]) => `${family} (${[...new Set(f.files.map((x) => x.weight + (x.style === 'italic' ? ' italic' : '')))].join(', ')}${f.licence ? `; ${f.licence}` : ''})`;
  main.innerHTML = `<h1>${esc(t('Shared blocks'))}</h1>${tabs}
    <p class="lead">${esc(t('The site\'s own fonts: the theme can name them, and every page gets them. Note each one\'s licence, so you know the site may publish it.'))}</p>
    ${fonts.length ? `<ul class="kitfiles fonts">${fonts.map((x) => `<li class="font">${esc(say(x))}</li>`).join('')}</ul>` : `<p class="empty">${esc(t('No fonts of its own yet.'))}</p>`}
    <form class="pubform fontform">
      <h2>${esc(t('Add a font'))}</h2>
      ${kit.fontFiles?.length ? `
      <label>${esc(t('Family'))}<input name="family" required placeholder="Diavlo"></label>
      <label>${esc(t('File'))}<select name="file">${kit.fontFiles.map((f) => `<option>${esc(f)}</option>`).join('')}</select></label>
      <label>${esc(t('Weight'))}<input name="weight" value="400"></label>
      <label>${esc(t('Style'))}<select name="style"><option value="normal">${esc(t('normal'))}</option><option value="italic">${esc(t('italic'))}</option></select></label>
      <label>${esc(t('Licence'))}<input name="licence" placeholder="${esc(t('e.g. SIL OFL, or bought for web use'))}"></label>
      <div class="row"><button class="btn primary" type="submit">${esc(t('Add the font'))}</button></div>`
      : `<p class="note">${esc(t('Add its files (.woff2, .woff, .ttf, .otf) to the site\'s files first, in Media.'))}</p>`}
    </form>`;
  main.onclick = (e) => {
    const tab = e.target.closest('[data-kit-tab]')?.dataset.kitTab;
    if (tab) return (kitTab = tab), (kitOpen = null), sharedScreen.render(main, ctx);
  };
  main.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await request('/_tykerf/site/kit/font', { family: f.family.value, file: f.file.value, weight: f.weight.value, style: f.style.value, licence: f.licence.value });
      toast(t('The font {family} is the site\'s now', { family: f.family.value.trim() }));
      await ctx.refresh();
    } catch (err) {
      failed(err);
    }
  };
}

/** The kit's other files (styles, behaviours, box types, tags): a list, and one file open to edit. */
async function renderKitFiles(main, ctx, kit, tabs) {
  const kind = kitTab;
  const names = kind === 'tags' ? (kit.files.tags ? ['tags'] : []) : kit.files[kind] ?? [];
  const what = { styles: t('Styles every page of the site gets, in its own layer. A style starting @scope (.k-<name>) is a style for a class.'), scripts: t('Behaviours: scripts the site\'s pages load, for boxes that ask for them with data-use.'), types: t('Box types: what a kind of box may hold and where it may go.'), tags: t('The site\'s own tags for boxes, as JSON.') }[kind];
  main.innerHTML = `<h1>${esc(t('Shared blocks'))}</h1>${tabs}<p class="lead">${esc(what)}</p>
    ${kitOpen ? `<form class="kitedit">
      ${kitOpen.isNew ? `<label>${esc(t('Name'))}<input name="name" required pattern="[a-z0-9][a-z0-9-]*"></label>` : `<h2>${esc(kitOpen.name)}</h2>`}
      <textarea name="text" spellcheck="false" aria-label="${esc(t('The file'))}">${esc(kitOpen.text ?? '')}</textarea>
      <div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button><button class="btn" type="button" data-k="close">${esc(t('Close'))}</button>
      ${kitOpen.isNew || kind === 'tags' ? '' : `<span class="spacer"></span><button class="btn danger" type="button" data-k="delete">${esc(t('Delete {name}', { name: kitOpen.name }))}</button>`}</div>
    </form>` : `<ul class="kitfiles">${names.map((n) => `<li><button type="button" class="link" data-open="${esc(n)}">${esc(n)}</button></li>`).join('') || `<li class="empty">${esc(t('None yet.'))}</li>`}</ul>
    ${kind === 'tags' && names.length ? '' : `<button type="button" class="btn" data-k="new">${esc(kind === 'tags' ? t('Add tags') : t('New'))}</button>`}`}`;
  main.onclick = async (e) => {
    const tab = e.target.closest('[data-kit-tab]')?.dataset.kitTab;
    if (tab) return (kitTab = tab), (kitOpen = null), sharedScreen.render(main, ctx);
    const name = e.target.closest('[data-open]')?.dataset.open;
    const act = e.target.closest('[data-k]')?.dataset.k;
    try {
      if (name) {
        const r = await request(`/_tykerf/site/kit/file?kind=${kind}&name=${encodeURIComponent(name)}`);
        kitOpen = { name, text: r.text ?? '' };
      }
      if (act === 'new') kitOpen = kind === 'tags' ? { name: 'tags', text: '{}\n' } : { isNew: true, text: '' };
      if (act === 'close') kitOpen = null;
      if (act === 'delete') {
        await request('/_tykerf/site/kit/file', { kind, name: kitOpen.name, text: null });
        kitOpen = null;
        toast(t('Deleted. Undo brings it back.'));
      }
      if (name || act) await sharedScreen.render(main, ctx);
    } catch (err) {
      failed(err);
    }
  };
  main.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const n = kitOpen.isNew ? f.elements.name.value.trim() : kitOpen.name;
    try {
      const r = await request('/_tykerf/site/kit/file', { kind, name: n, text: f.elements.text.value });
      toast(r.warning ?? t('Saved: every page of the site has it now'), !!r.warning);
      kitOpen = { name: n, text: f.elements.text.value };
      await ctx.refresh();
    } catch (err) {
      failed(err);
    }
  };
}

// ---------- check the site (R11) ----------

/** Which findings Kaity can fix by herself; the rest are the person's to decide (an assumption: see the plan, Q5). */
const KAITY_FIXES = new Set(['link', 'alt', 'title', 'orphan', 'copy', 'shared-file']);
const LANGS = ['en', 'es', 'ca', 'gl', 'eu', 'pt', 'pt-BR', 'fr', 'de', 'it', 'nl'];

const checkScreen = {
  title: () => t('Check the site'),
  async render(main, ctx) {
    const [r, site] = await Promise.all([request('/_tykerf/site/check'), request('/_tykerf/site')]);
    const all = r.findings;
    const kaitys = all.filter((f) => KAITY_FIXES.has(f.kind));
    const groups = r.kinds.map(([kind, heading]) => [kind, heading, all.filter((f) => f.kind === kind)]).filter(([, , fs]) => fs.length);
    // findings about the same thing on one page are one row
    const rows = (fs) => {
      const by = new Map();
      for (const f of fs) {
        const k = `${f.page ?? ''}`;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(f);
      }
      return [...by.values()];
    };
    const fix = (kind, fs) => {
      const f = fs[0], p = f.page;
      if (kind === 'title' && p) return `<form class="inline" data-title="${esc(p)}"><input name="title" value="${esc(site.ownTitles?.[p] ?? '')}" placeholder="${esc(site.titles?.[p] ?? '')}" aria-label="${esc(t('The title of {page}', { page: p }))}"><button class="btn small primary" type="submit">${esc(t('Save'))}</button></form>`;
      if (kind === 'lang') return `<form class="inline" data-lang><input name="lang" list="langs" value="${esc(site.lang ?? '')}" placeholder="en" aria-label="${esc(t('The site\'s language'))}"><datalist id="langs">${LANGS.map((l) => `<option value="${l}">`).join('')}</datalist><button class="btn small primary" type="submit">${esc(t('Set the language'))}</button></form>`;
      if (kind === 'orphan' && p) return `<button type="button" class="btn small" data-nav="${esc(p)}">${esc(t('Add it to the shared nav'))}</button>`;
      if (p && f.box) return `<a class="btn small" href="${edit(p, `?show=${encodeURIComponent(f.box)}`)}">${esc(t('Open the box'))}</a>`;
      if (p) return `<a class="btn small" href="${edit(p)}">${esc(t('Open the page'))}</a>`;
      return '';
    };
    main.innerHTML = `
      <h1>${esc(t('Check the site'))}</h1>
      <p class="lead">${esc(all.length ? (all.length === 1 ? t('1 thing to check, in 1 group.') : t('{n} things to check, in {g} groups.', { n: all.length, g: groups.length })) : t('Nothing to check: every link leads somewhere, every file is there, and every page has a title.'))}</p>
      ${kaitys.length ? `<div class="give"><button type="button" class="btn main big" data-c="kaity">${esc(kaitys.length === 1 ? t('Give Kaity the 1 she can fix') : t('Give Kaity the {n} she can fix', { n: kaitys.length }))}</button><p class="scope">${esc(t('She works on the whole site for them, page by page, and says what she changed.'))}</p></div>` : ''}
      ${groups.map(([kind, heading, fs]) => `<section class="cgroup">
        <header><h2>${esc(cap(t(heading)))}</h2><span class="badge">${fs.length}</span><span class="tag">${esc(KAITY_FIXES.has(kind) ? t('Kaity can fix') : t('Yours to decide'))}</span></header>
        <ul>${rows(fs).map((g) => `<li><div class="cwhat">${g[0].page ? `<b>${esc(g[0].page)}</b>` : `<b>${esc(t('The whole site'))}</b>`}${g.length > 1 ? ` <span class="count">${esc(t('{n} times', { n: g.length }))}</span>` : ''}<p>${esc(cap(g[0].detail))}${g.length > 1 ? '…' : ''}</p></div><div class="cfix">${fix(kind, g)}</div></li>`).join('')}</ul>
      </section>`).join('')}`;
    main.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.dataset.title) await request('/_tykerf/site/title', { name: f.dataset.title, title: f.elements.title.value.trim() });
        if ('lang' in f.dataset) await request('/_tykerf/site/lang', { lang: f.elements.lang.value.trim() });
        toast(t('Saved'));
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
    main.onclick = (e) => {
      const nav = e.target.closest('[data-nav]')?.dataset.nav;
      if (nav) return askKaity(`Add a link to the page /${nav}/ in the site's shared navigation (the shared block nav), so visitors can reach it from every page.`, ctx);
      if (e.target.closest('[data-c="kaity"]')) {
        return askKaity(`Fix these things the site's check found, page by page, and say what you changed for each:\n${kaitys.map((f) => `- ${f.page ? `${f.page}${f.box ? ` (${f.box})` : ''}: ` : ''}${f.detail}${f.fix ? ` (${f.fix})` : ''}`).join('\n')}`, ctx);
      }
    };
  },
};

// ---------- media (R11) ----------

let mediaFilter = 'all';
let published = null; // what the last Publish here said: { ok, text, url? }

const mediaScreen = {
  title: () => t('Media'),
  async render(main, ctx) {
    const { files } = await request('/_tykerf/site/media');
    const twice = keptTwice(files);
    const unused = (f) => !f.used.length && !f.held;
    const shown = files.filter((f) => mediaFilter === 'all' || (mediaFilter === 'pictures' && f.kind === 'image') || (mediaFilter === 'fonts' && f.kind === 'font') || (mediaFilter === 'unused' && unused(f)));
    const src = (f) => (f.where === 'site' ? `/assets/${encodeURIComponent(f.file)}` : `/${encodeURIComponent(f.where)}/assets/${encodeURIComponent(f.file)}`);
    const where = (f) => (f.where === 'site' ? t('the site\'s files') : t('{page}\'s own files', { page: f.where }));
    const used = (f) => (f.used.length ? t('Used on {where}', { where: [...new Set(f.used.map((u) => u.page ?? t('every page')))].join(', ') }) : f.held ? t('Not used; kept for Undo') : t('Not used'));
    const pictures = shown.filter((f) => f.kind === 'image'), others = shown.filter((f) => f.kind !== 'image');
    const filters = [['all', t('All')], ['pictures', t('Pictures')], ['fonts', t('Fonts')], ['unused', t('Unused')]];
    main.innerHTML = `
      <h1>${esc(t('Media'))}</h1>
      <p class="lead">${esc(t('{n} files: the site\'s own, which every page can use, and each page\'s.', { n: files.length }))}</p>
      ${twice.length ? `<div class="suggest"><p>${esc(twice.length === 1 ? t('1 picture is kept twice: a copy in a page as well as in the site\'s files.') : t('{n} pictures are kept twice: a copy in a page as well as in the site\'s files.', { n: twice.length }))}</p><button type="button" class="btn primary" data-m="dedupe">${esc(t('Use the site\'s files'))}</button></div>` : ''}
      <div class="filters" role="group" aria-label="${esc(t('Show'))}">${filters.map(([k, l]) => `<button type="button" class="btn small" data-filter="${k}" aria-pressed="${k === mediaFilter}">${esc(l)}</button>`).join('')}</div>
      ${pictures.length ? `<div class="mcards">${pictures.map((f) => `<article class="mcard">
        <img src="${src(f)}" alt="" loading="lazy">
        <h3>${esc(f.file)}</h3><p class="note">${esc(size(f.bytes))} · ${esc(where(f))}</p><p>${esc(used(f))}</p>
        <div class="row">${f.where !== 'site' ? `<button type="button" class="btn small" data-move="${esc(f.where)}|${esc(f.file)}">${esc(t('Move to the site'))}</button>` : ''}${unused(f) ? `<button type="button" class="btn small danger" data-remove="${esc(f.where)}|${esc(f.file)}">${esc(t('Remove'))}</button>` : ''}</div>
      </article>`).join('')}</div>` : ''}
      ${others.length ? `<h2>${esc(mediaFilter === 'fonts' ? t('Fonts') : t('Fonts and other files'))}</h2><ul class="mlist">${others.map((f) => `<li><b>${esc(f.file)}</b> <span class="note">${esc(size(f.bytes))} · ${esc(where(f))} · ${esc(used(f))}</span></li>`).join('')}</ul>` : ''}
      ${!shown.length ? `<p class="empty">${esc(t('No files here.'))}</p>` : ''}`;
    main.onclick = async (e) => {
      const fl = e.target.closest('[data-filter]')?.dataset.filter;
      if (fl) return (mediaFilter = fl), mediaScreen.render(main, ctx);
      const move = e.target.closest('[data-move]')?.dataset.move, remove = e.target.closest('[data-remove]')?.dataset.remove;
      try {
        if (e.target.closest('[data-m="dedupe"]')) toast(t('{n} pages use the site\'s files now', { n: (await request('/_tykerf/site/media/dedupe', {})).result ?? 0 }));
        else if (move) {
          const [page, file] = move.split('|');
          await request('/_tykerf/site/media/move', { page, file });
          toast(t('{file} is one of the site\'s files now', { file }));
        } else if (remove) {
          const [w, file] = remove.split('|');
          await request('/_tykerf/site/media/remove', { where: w, file });
          toast(t('{file} is removed. Undo brings it back.', { file }));
        } else return;
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
  },
};

// ---------- links between pages (R11) ----------

const linksScreen = {
  title: () => t('Links between pages'),
  async render(main, ctx) {
    const [{ links }, site] = await Promise.all([request('/_tykerf/site/links'), request('/_tykerf/site')]);
    const good = links.filter((l) => !l.broken && l.to !== l.page), broken = links.filter((l) => l.broken);
    const hard = hardToReach(site.pages, links, site.home);
    const to = (p) => [...new Set(good.filter((l) => l.page === p).map((l) => l.to))];
    const from = (p) => [...new Set(good.filter((l) => l.to === p).map((l) => l.page))];
    const pairs = new Set(good.map((l) => `${l.page}>${l.to}`)).size;
    const headline = !good.length ? t('No page links to another yet: visitors only find the pages through the list of pages or a search.')
      : hard.length ? (hard.length === 1 ? t('{n} links between pages, and 1 page that nothing links to.', { n: pairs }) : t('{n} links between pages, and {h} pages that nothing links to.', { n: pairs, h: hard.length }))
      : t('{n} links between pages: every page can be reached from another.', { n: pairs });
    main.innerHTML = `
      <h1>${esc(t('Links between pages'))}</h1>
      <p class="lead big">${esc(headline)}</p>
      <div class="give"><button type="button" class="btn main" data-l="kaity">${esc(t('Ask Kaity to link the pages'))}</button><p class="scope">${esc(t('She opens each page, links it from the shared navigation or a page about it, and says what she changed.'))}</p></div>
      ${broken.length ? `<section class="cgroup bad"><header><h2>${esc(t('Links that lead nowhere'))}</h2><span class="badge">${broken.length}</span></header><ul>${broken.map((l) => `<li><div class="cwhat"><b>${esc(l.page)}</b><p>${esc(t('{href} goes to "{to}", a page the site doesn\'t have', { href: l.href, to: l.to }))}</p></div><div class="cfix">${l.box ? `<a class="btn small" href="${edit(l.page, `?show=${encodeURIComponent(l.box)}`)}">${esc(t('Open the box'))}</a>` : ''}</div></li>`).join('')}</ul></section>` : ''}
      <div class="lcards">${site.pages.map((p) => `<article class="lcard">
        <h3>${esc(p)} <span class="addr">/${esc(p)}/</span>${p === site.home ? `<span class="hometag">${esc(t('Home'))}</span>` : ''}${hard.includes(p) ? `<span class="tag warn">${esc(t('Hard to reach'))}</span>` : ''}</h3>
        <p>${to(p).length ? t('Links to {pages}', { pages: list(to(p)) }) : esc(t('Links to no other page'))}</p>
        <p>${from(p).length ? t('Linked from {pages}', { pages: list(from(p)) }) : esc(t('No page links here'))}</p>
        ${hard.includes(p) ? `<button type="button" class="btn small" data-nav="${esc(p)}">${esc(t('Add it to the shared nav'))}</button>` : ''}
      </article>`).join('')}</div>`;
    main.onclick = (e) => {
      const nav = e.target.closest('[data-nav]')?.dataset.nav;
      if (nav) return askKaity(`Add a link to the page /${nav}/ in the site's shared navigation (the shared block nav), so visitors can reach it from every page.`, ctx);
      if (e.target.closest('[data-l="kaity"]')) return askKaity(`Link the site's pages: every page should be reachable from the shared navigation or from a page about it, and no link should lead to a page the site doesn't have. ${hard.length ? `Nothing links to ${hard.join(', ')} yet.` : ''} Say what you changed, page by page.`, ctx);
    };
  },
};

// ---------- Kaity on the whole site, and her work everywhere (R14) ----------

let workFilter = 'all'; // the runs shown: all, the whole site's, or one page's

const kaityScreen = {
  title: () => t('Kaity\'s work'),
  async render(main, ctx) {
    const [chat, work] = await Promise.all([request('/_tykerf/site/chat'), request('/_tykerf/site/kaity')]);
    const msgs = chat.messages.filter((m) => m.role !== 'step').slice(-12);
    const steps = chat.messages.filter((m) => m.role === 'step');
    const runWord = { working: t('Working'), done: t('Done'), failed: t('Failed'), stopped: t('Stopped'), 'cut short': t('Cut short: TYKERF stopped while she worked') };
    const pages = [...new Set(work.runs.map((r) => r.page).filter(Boolean))];
    const runs = work.runs.filter((r) => workFilter === 'all' || (workFilter === 'site' ? !r.page : r.page === workFilter));
    const going = work.runs.filter((r) => r.state === 'working').length;
    const where = (r) => (r.page ? `<a href="/_tykerf/edit/${encodeURIComponent(r.page)}/?mode=full${r.block ? `&block=${encodeURIComponent(r.block)}&tab=ai` : ''}">${esc(r.page)}${r.block ? ` · ${esc(r.block)}` : ''}</a>` : `<b>${esc(t('The whole site'))}</b>`);
    main.innerHTML = `
      <h1>${esc(t('Kaity\'s work'))}</h1>
      <section class="convo">
        <h2>${esc(t('Kaity on the whole site'))}</h2>
        ${msgs.length ? `<ol class="msgs">${msgs.map((m) => `<li class="msg ${esc(m.role)}">${m.role === 'ai' ? `<b>Kaity</b> ` : m.role === 'user' ? `<b>${esc(t('You'))}</b> ` : ''}${esc(m.text)}</li>`).join('')}</ol>` : `<p class="empty">${esc(t('Ask her about the whole site: she opens the pages herself and works on them one by one.'))}</p>`}
        ${chat.running ? `<p class="working" data-step>${kaityMark(true, true)} ${esc(steps.at(-1)?.text ?? t('Starting…'))}</p><button type="button" class="btn" data-k="stop">${esc(t('Stop Kaity'))}</button>` : `
        <form class="askk wide">${kaityMark(false, true)}<label for="ask-site-2">${esc(t('Ask Kaity about the whole site'))}</label><input id="ask-site-2" name="prompt" autocomplete="off" placeholder="${esc(t('e.g. Link the navigation to all the pages'))}"><button class="btn primary" type="submit">${esc(t('Ask'))}</button></form>`}
      </section>
      <h2>${esc(t('Everything she did on the site'))}</h2>
      <div class="row workhead"><p class="summary">${esc(t('{going} going on now, {done} finished.', { going, done: work.runs.length - going }))}</p>
        ${work.runs.length ? `<select data-k="filter" aria-label="${esc(t('Show'))}"><option value="all">${esc(t('Everywhere'))}</option><option value="site" ${workFilter === 'site' ? 'selected' : ''}>${esc(t('The whole site'))}</option>${pages.map((p) => `<option value="${esc(p)}" ${workFilter === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}</div>
      ${runs.length ? `<ul class="runs">${runs.slice(0, 40).map((r) => `<li class="run ${esc(r.state.replace(' ', '-'))}">
        <div class="rhead"><span class="state ${r.state === 'working' ? 'now' : r.state === 'done' ? 'done' : ''}">${esc(runWord[r.state] ?? r.state)}</span>${where(r)}<span class="note">${esc(when(r.at))}${r.steps ? ` · ${esc(r.steps === 1 ? t('1 step') : t('{n} steps', { n: r.steps }))}` : ''}</span></div>
        <p class="rreq">${esc(r.request)}</p>${r.answer ? `<div class="note md">${markdown(r.answer)}</div>` : ''}${r.error ? `<p class="note bad">${esc(r.error)}</p>` : ''}${r.step ? `<p class="note">${esc(r.step)}</p>` : ''}
      </li>`).join('')}</ul>` : `<p class="empty">${esc(t('Nothing yet.'))}</p>`}`;
    main.onchange = (e) => {
      if (e.target.dataset.k !== 'filter') return;
      workFilter = e.target.value;
      void kaityScreen.render(main, ctx);
    };
    main.onsubmit = async (e) => {
      e.preventDefault();
      const prompt = e.target.elements.prompt.value.trim();
      if (prompt) await askKaity(prompt, ctx);
    };
    main.onclick = async (e) => {
      if (e.target.closest('[data-k="stop"]')) await request('/_tykerf/site/ask/cancel', {}).catch(failed);
    };
  },
  onAi(m, main, ctx) {
    if (m.role === 'step') {
      const el = $('[data-step]', main);
      if (el) el.lastChild.textContent = ` ${m.text}`;
      return;
    }
    void kaityScreen.render(main, ctx);
  },
};

// ---------- the site's history (R14) ----------

let emptying = false; // the trash's Empty asks first

const historyScreen = {
  title: () => t('Site history'),
  async render(main, ctx) {
    const [h, trash] = await Promise.all([request('/_tykerf/site/history'), request('/_tykerf/site/trash').catch(() => ({ pages: [] }))]);
    main.innerHTML = `
      <h1>${esc(t('Site history'))}</h1>
      <p class="lead">${esc(t('The steps that changed the whole site: its shared theme and head, its kit, its settings. A page\'s own changes and tasks are undone on that page.'))}</p>
      <div class="row">
        <button type="button" class="btn primary" data-h="undo" ${h.undo ? '' : 'disabled'}>${esc(h.undo ? t('Undo "{step}"', { step: h.undo.label }) : t('Nothing to undo'))}</button>
        <button type="button" class="btn" data-h="redo" ${h.redo ? '' : 'disabled'}>${esc(h.redo ? t('Redo "{step}"', { step: h.redo.label }) : t('Nothing to redo'))}</button>
      </div>
      ${h.steps.length ? `<ol class="steps">${h.steps.map((s) => `<li><b>${esc(s.label)}</b> <span class="note">${esc(s.author === 'ai' ? t('Kaity') : t('you'))} · ${esc(when(s.at))}</span></li>`).join('')}</ol>` : `<p class="empty">${esc(t('No steps yet.'))}</p>`}
      ${trash.pages.length ? `<section class="trashsec">
        <h2>${esc(t('Removed pages'))}</h2>
        <p class="note">${esc(t('They wait in the site\'s .trash folder, whole, until it is emptied.'))}</p>
        <ul class="steps">${trash.pages.map((x) => `<li><b>${esc(x.page)}</b> <span class="note">${esc(x.removed ? when(x.removed) : '')}</span></li>`).join('')}</ul>
        ${emptying ? `<div class="confirm" role="alert"><p>${esc(t('Delete {n} removed pages for good? This cannot be undone.', { n: trash.pages.length }))}</p><div class="row"><button type="button" class="btn danger" data-h="empty-yes">${esc(t('Delete them for good'))}</button><button type="button" class="btn" data-h="empty-no">${esc(t('Cancel'))}</button></div></div>`
          : `<button type="button" class="btn danger" data-h="empty">${esc(t('Empty the trash for good…'))}</button>`}
      </section>` : ''}`;
    main.onclick = async (e) => {
      const act = e.target.closest('[data-h]')?.dataset.h;
      if (!act) return;
      if (act === 'empty' || act === 'empty-no') return (emptying = act === 'empty'), historyScreen.render(main, ctx);
      if (act === 'empty-yes') {
        emptying = false;
        await request('/_tykerf/site/trash/empty', {}).catch(failed);
        return ctx.refresh();
      }
      try {
        const r = await request(`/_tykerf/site/${act}`, {});
        toast(act === 'undo' ? t('Undone: {step}', { step: r.result ?? '' }) : t('Redone: {step}', { step: r.result ?? '' }));
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
  },
};

// ---------- head code, icon and language (R14) ----------

const settingsScreen = {
  title: () => t('Head code, icon & language'),
  async render(main, ctx) {
    const [site, icon, code, ai] = await Promise.all([request('/_tykerf/site'), request('/_tykerf/site/icon'), request('/_tykerf/site/code'), request('/_tykerf/ai/status').catch(() => null)]);
    main.innerHTML = `
      <h1>${esc(t('Head code, icon & language'))}</h1>
      <section class="setting">
        <h2>${esc(t('Language'))}</h2>
        <p class="note">${esc(t('Every page says it is in this language (its lang), which screen readers, browsers and search engines use.'))}</p>
        <form class="inline" data-s="lang"><input name="lang" list="langs2" value="${esc(site.lang ?? '')}" placeholder="en" aria-label="${esc(t('Language'))}"><datalist id="langs2">${LANGS.map((l) => `<option value="${l}">`).join('')}</datalist><button class="btn primary" type="submit">${esc(t('Set the language'))}</button></form>
        ${site.langSet ? '' : `<p class="warn">${esc(t('Not set yet: every page says it is in English.'))}</p>`}
      </section>
      <section class="setting">
        <h2>${esc(t('The site\'s icon'))}</h2>
        <p class="note">${esc(icon.own ? t('Your own icon, in the browser\'s tab and bookmarks.') : t('Made by tykerf from the site\'s name and theme until you choose one.'))}</p>
        <div class="row"><img class="icon" src="/${esc(icon.file)}?v=${Date.now()}" alt="${esc(t('The site\'s icon'))}" width="48" height="48">
          <label class="btn">${esc(t('Choose a picture…'))}<input type="file" accept="image/svg+xml,image/png,image/x-icon" data-s="icon" hidden></label>
          ${icon.own ? `<button type="button" class="btn" data-s="icon-made">${esc(t('Use the made one'))}</button>` : ''}</div>
      </section>
      <section class="setting">
        <h2>${esc(t('Head code'))}</h2>
        <p class="note">${esc(t('What every page has in its head besides the theme and fonts: meta tags, analytics, scripts. Styles belong in the site kit\'s Styles.'))}</p>
        ${code.styles ? `<div class="suggest headstyles"><p>${esc(code.styles === 1 ? t('The head code has a style block: styles for every page belong in the site kit. Move it to the kit\'s styles?') : t('The head code has {n} style blocks: styles for every page belong in the site kit. Move them to the kit\'s styles?', { n: code.styles }))}</p><button type="button" class="btn primary" data-s="migrate">${esc(t('Move to the kit'))}</button></div>` : ''}
        <form data-s="code"><textarea name="code" spellcheck="false" aria-label="${esc(t('Head code'))}">${esc(code.code)}</textarea><div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button></div></form>
      </section>
      ${ai ? `<section class="setting">
        <h2>${esc(t('Kaity status'))}</h2>
        <p>${esc({ 'claude-code': t('Claude Code'), anthropic: t('Anthropic API'), gemini: t('Gemini API') }[ai.runner] ?? ai.runner)}${ai.model ? ` · ${esc(ai.model)}` : ''} · ${esc(ai.ready ? t('ready') : t('not ready'))}</p><p class="note">${esc(ai.note ?? '')}</p>
        ${ai.testable ? `<button type="button" class="btn" data-s="test">${esc(t('Test it'))}</button>` : ''}
      </section>` : ''}`;
    main.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.dataset.s === 'lang') await request('/_tykerf/site/lang', { lang: f.elements.lang.value.trim() });
        if (f.dataset.s === 'code') await request('/_tykerf/site/code', { code: f.elements.code.value });
        toast(t('Saved: every page has it now'));
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
    main.onchange = async (e) => {
      if (e.target.dataset.s !== 'icon' || !e.target.files?.[0]) return;
      const file = e.target.files[0];
      try {
        await request('/_tykerf/site/icon', { type: file.type, data: await base64(file) });
        await settingsScreen.render(main, ctx);
      } catch (err) {
        failed(err);
      }
    };
    main.onclick = async (e) => {
      const act = e.target.closest('button[data-s]')?.dataset.s;
      try {
        if (act === 'icon-made') (await request('/_tykerf/site/icon', {}), await settingsScreen.render(main, ctx));
        if (act === 'migrate') {
          const n = (await request('/_tykerf/site/kit/migrate-head', {})).result;
          toast(t('Moved {n} to the kit: kit/styles/head.css', { n }));
          await ctx.refresh();
        }
        if (act === 'test') {
          e.target.disabled = true;
          const r = await request('/_tykerf/ai/test', {});
          toast(t('Kaity answered in {s} s: {answer}', { s: (r.ms / 1000).toFixed(1), answer: r.answer }));
          e.target.disabled = false;
        }
      } catch (err) {
        failed(err);
        e.target.disabled = false;
      }
    };
  },
};

// ---------- publish and export (R14) ----------

const publishScreen = {
  title: () => t('Publish'),
  async render(main, ctx) {
    const r = await request('/_tykerf/site/publish');
    const s = r.settings ?? { repo: '', branch: 'main', folder: '', url: '', credit: true };
    main.innerHTML = `
      <h1>${esc(t('Publish'))}</h1>
      <p class="lead">${esc(t('tykerf exports the site and commits it to a GitHub repository. Connect that repository once to GitHub Pages, Cloudflare Pages or Netlify, and every publish goes live. Only the files tykerf published there are ever replaced or removed.'))}</p>
      ${r.last ? `<p>${esc(t('Last published {when} to {repo}, branch {branch}.', { when: when(r.last.at), repo: r.last.repo, branch: r.last.branch }))}</p>` : ''}
      <div class="give"><button type="button" class="btn main big" data-p="publish" ${r.settings && r.token && !r.running ? '' : 'disabled'}>${esc(r.running ? t('Publishing…') : t('Publish the site now'))}</button>
        <p class="scope">${esc(!r.token ? t('tykerf needs a GitHub token: add TYKERF_GITHUB_TOKEN to .env, then restart it.') : !r.settings ? t('Say where to publish first, below.') : t('Every page goes, as it is now.'))}</p></div>
      <p class="pubtoken note">${esc(r.token ? t('GitHub token: set') : t('GitHub token: not set'))}</p>
      ${published ? `<p class="pubmsg ${published.ok ? '' : 'bad'}" role="status">${esc(published.text)}${published.url ? ` <a href="${esc(published.url)}" target="_blank" rel="noopener">${esc(t('See the commit'))}</a>` : ''}</p>` : ''}
      <form class="pubform">
        <h2>${esc(t('Where to'))}</h2>
        <label>${esc(t('Repository (owner/name)'))}<input name="repo" value="${esc(s.repo)}" placeholder="eonity-org/my-site" required></label>
        <label>${esc(t('Branch'))}<input name="branch" value="${esc(s.branch)}" required></label>
        <label>${esc(t('Folder (empty: the branch\'s root)'))}<input name="folder" value="${esc(s.folder ?? '')}" placeholder="docs"></label>
        <label>${esc(t('The site\'s address once published'))}<input name="url" value="${esc(s.url ?? '')}" placeholder="https://example.org"></label>
        <label class="check"><input type="checkbox" name="credit" ${s.credit !== false ? 'checked' : ''}> ${esc(t('Say "Made with tykerf" at the bottom of the pages'))}</label>
        <div class="row"><button class="btn primary" type="submit">${esc(t('Save where to publish'))}</button></div>
      </form>
      <section class="setting">
        <h2>${esc(t('Export'))}</h2>
        <p class="note">${esc(t('The site as plain files for any web host, in a ZIP file.'))}</p>
        <div class="row"><a class="btn" href="/_tykerf/export.zip" download>${esc(t('Export the site'))}</a>
        ${ctx.from ? `<a class="btn" href="/_tykerf/export.zip?page=${encodeURIComponent(ctx.from)}" download>${esc(t('Export {page} only', { page: ctx.from }))}</a>` : ''}
        <a class="btn" href="/_tykerf/export.zip?links=files" download>${esc(t('Export to open from disk'))}</a></div>
      </section>`;
    main.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await request('/_tykerf/site/publish/settings', { settings: { repo: f.elements.repo.value.trim(), branch: f.elements.branch.value.trim(), folder: f.elements.folder.value.trim(), url: f.elements.url.value.trim() || undefined, credit: f.elements.credit.checked } });
        published = { ok: true, text: t('Saved: the site goes there when you publish.') };
      } catch (err) {
        published = { ok: false, text: err.message };
      }
      await publishScreen.render(main, ctx);
    };
    main.onclick = async (e) => {
      if (!e.target.closest('[data-p="publish"]')) return;
      e.target.disabled = true;
      e.target.textContent = t('Publishing…');
      try {
        const { result: x } = await request('/_tykerf/site/publish', {});
        published = x.commit
          ? { ok: true, text: t('Published: {added} new, {changed} changed and {removed} removed files.', { added: x.added, changed: x.changed, removed: x.removed }), url: x.commit.url }
          : { ok: true, text: t('Nothing changed since the last publish.') };
      } catch (err) {
        published = { ok: false, text: err.message };
      }
      await publishScreen.render(main, ctx);
    };
  },
};

// ---------- a new page (R10) ----------

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const isZip = (f) => /\.zip$/i.test(f.name) || ['application/zip', 'application/x-zip-compressed'].includes(f.type);
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
let draft = null; // what the person has written, chosen and dropped on the New page screen

const newScreen = {
  title: () => t('New page'),
  full: true, // no page yet, and no sidebar: the whole window
  async render(main, ctx) {
    const [site, { layouts, themes }, ai] = await Promise.all([request('/_tykerf/site'), request('/_tykerf/library'), request('/_tykerf/ai/status').catch(() => ({ ready: false, note: '' }))]);
    const taken = site.pages;
    let n = taken.length + 1;
    while (taken.includes(`page-${n}`)) n++;
    draft ??= { name: `page-${n}`, prompt: '', images: [], zip: null, layout: layouts.some((l) => l.name === 'launch') ? 'launch' : layouts[0].name, url: '', structureOnly: false, shared: true, theme: themes.some((x) => x.name === 'studio') ? 'studio' : themes[0].name };
    const L = () => layouts.find((l) => l.name === draft.layout);
    const draw = () => {
      const nm = draft.name || '…';
      main.innerHTML = `
      <div class="newpage">
        <h1>${esc(t('What page do you want?'))}</h1>
        <p class="lead">${esc(t('Show it, describe it, or both. Kaity builds it while you watch.'))}</p>
        <div class="np-top">
          <form class="np-kaity" data-np="kaity">
            <label class="fxlabel" for="np-prompt">${esc(t('Describe it'))}</label>
            <textarea id="np-prompt" name="prompt" rows="4" placeholder="${esc(t('e.g. A launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map'))}">${esc(draft.prompt)}</textarea>
            <div class="np-drop" tabindex="0" role="button" aria-label="${esc(t('Add images'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>
              <p><b>${esc(t('Show it.'))}</b> ${esc(t('Drop or paste up to 3 images (a screenshot of a page you like, a sketch, a mock-up) or a design exported as a ZIP file.'))}</p>
              <span class="btn small">${esc(t('Choose files'))}</span>
              <input type="file" accept="${[...IMAGE_TYPES, '.zip', 'application/zip'].join(',')}" multiple hidden>
            </div>
            ${draft.images.length || draft.zip ? `<div class="np-pics">${draft.images.map((a, i) => `<span><img src="data:${a.mediaType};base64,${a.data}" alt=""><button type="button" data-unpic="${i}" aria-label="${esc(t('Remove this image'))}">×</button></span>`).join('')}${draft.zip ? `<span class="np-zip"><b>${esc(draft.zip.name)}</b><button type="button" data-unzip aria-label="${esc(t('Remove the ZIP file'))}">×</button></span>` : ''}</div>` : ''}
            <div class="np-name">
              <label class="fxlabel" for="np-name">${esc(t('Page name'))}</label>
              <input id="np-name" name="name" value="${esc(draft.name)}" spellcheck="false" autocomplete="off">
              <p class="note">${esc(t('Its address will be /{name}/.', { name: nm }))} ${esc(site.sharedTheme ? t('It uses the site\'s theme.') : t('Kaity chooses a theme that fits.'))}</p>
            </div>
            <p class="np-error" role="alert" hidden></p>
            <button class="btn main big" type="submit" ${ai.ready ? '' : 'disabled'}>${esc(t('Build it with Kaity'))}</button>
            ${ai.ready ? '' : `<p class="warn">${esc(t('Kaity is not ready here: {note}', { note: ai.note ?? '' }))} ${esc(t('Start from a layout or a copy of a website instead, and ask Kaity later.'))}</p>`}
          </form>
          <aside class="np-what">
            <h2>${esc(t('What happens'))}</h2>
            <ol>
              <li>${esc(t('Kaity picks the layout that fits best, and the theme unless you choose one.'))}</li>
              <li>${esc(t('The page opens at once, and you see each step as she builds it from your words and pictures.'))}</li>
              <li>${esc(t('Everything she does is a normal change: stop it at any time, undo a step, or ask for more.'))}</li>
            </ol>
            <p class="note">${esc(t('It uses your AI account and takes a few minutes.'))}</p>
          </aside>
        </div>
        <h2>${esc(t('Or start without Kaity'))}</h2>
        <div class="np-without">
          <form class="np-card" data-np="layout">
            <h3>${esc(t('From a layout'))}</h3>
            <p class="note">${esc(t('A ready-made structure of blocks, then change anything.'))}</p>
            <div class="np-chips">${layouts.map((l) => `<button type="button" class="btn" data-layout="${esc(l.name)}" aria-pressed="${l.name === draft.layout}">${esc(t(l.label))}</button>`).join('')}</div>
            <p><b>${esc(t(L().label))}:</b> ${esc(t(L().description))}</p>
            ${L().shared?.length ? `<label class="check"><input type="checkbox" name="shared" ${draft.shared ? 'checked' : ''}> ${esc(t('With the site\'s navigation and footer (shared): one for every page, so a change to them reaches every page. Without it, this page gets copies of its own.'))}</label>` : ''}
            ${site.sharedTheme ? '' : `<label class="fxlabel" for="np-theme">${esc(t('Theme'))}</label>
            <select id="np-theme" name="theme">${themes.map((x) => `<option value="${esc(x.name)}" ${x.name === draft.theme ? 'selected' : ''}>${esc(t(x.label))}</option>`).join('')}</select>
            <p class="note">${esc(t('The site\'s pages share it. You can change the colours, fonts and spacing later in the full editor\'s Page tab.'))}</p>`}
            <div class="row"><button class="btn primary" type="submit">${esc(t('Create {name} from it', { name: nm }))}</button><a class="btn" href="/_tykerf/preview/${encodeURIComponent(draft.layout)}/${site.sharedTheme ? 'site' : encodeURIComponent(draft.theme)}/" target="_blank" rel="noopener">${esc(t('Preview at full size'))}</a></div>
          </form>
          <form class="np-card" data-np="copy">
            <h3>${esc(t('From a copy of a web page'))}</h3>
            <p class="note">${esc(t('TYKERF opens the site in a browser and cuts the page into rows, columns and boxes. The copy is a starting point, not a perfect clone: check it at desktop and phone widths.'))}</p>
            <label class="fxlabel" for="np-url">${esc(t('Web address'))}</label>
            <input id="np-url" name="url" type="url" value="${esc(draft.url)}" placeholder="https://example.com" spellcheck="false" autocomplete="url">
            <label class="check"><input type="checkbox" name="structureOnly" ${draft.structureOnly ? 'checked' : ''}> ${esc(t('Only the layout: leave out the site\'s text, images and styles'))}</label>
            <p class="note">${esc(t('A copy includes the site\'s text, images and design, which usually belong to someone else. Copy your own site to rebuild it; copy someone else\'s only to study or prototype, and publish it only with the owner\'s permission.'))}</p>
            <div class="row"><button class="btn primary" type="submit">${esc(t('Copy the page'))}</button></div>
          </form>
        </div>
      </div>`;
    };
    draw();
    const error = (msg, field) => {
      const el = $('.np-error', main);
      el.hidden = !msg;
      el.textContent = msg ?? '';
      if (msg) (field ?? el).scrollIntoView({ block: 'center' }), field?.focus();
    };
    const addFiles = async (files) => {
      for (const f of files) {
        if (isZip(f)) {
          if (f.size > 8 * 1024 * 1024) return error(t('The ZIP file is larger than 8 MB.'));
          draft.zip = { name: f.name, data: await base64(f) };
          continue;
        }
        if (draft.images.length >= 3) return error(t('Up to 3 images.'));
        if (!IMAGE_TYPES.includes(f.type)) continue;
        if (f.size > 5 * 1024 * 1024) return error(t('An image is larger than 5 MB.'));
        draft.images.push({ mediaType: f.type, data: await base64(f) });
      }
      draw();
    };
    main.oninput = (e) => {
      const f = e.target;
      if (f.name === 'prompt') draft.prompt = f.value;
      if (f.name === 'url') {
        draft.url = f.value;
        // a copy is named after the site until the name is changed by hand
        if (!draft.named) {
          try {
            const n = new URL(f.value.trim()).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
            if (n) {
              draft.name = taken.includes(n) ? `${n}-copy` : n;
              $('#np-name', main).value = draft.name;
              main.oninput({ target: { name: 'name', value: draft.name, auto: true } });
            }
          } catch {}
        }
      }
      if (f.name === 'name') {
        if (!f.auto) draft.named = true;
        draft.name = f.value.trim();
        // the address and the buttons say the new name
        for (const p of main.querySelectorAll('.np-name .note')) p.firstChild.textContent = t('Its address will be /{name}/.', { name: draft.name || '…' });
        const b = $('[data-np="layout"] [type="submit"]', main);
        if (b) b.textContent = t('Create {name} from it', { name: draft.name || '…' });
      }
    };
    main.onchange = (e) => {
      const f = e.target;
      if (f.type === 'file') return addFiles([...f.files]);
      if (f.name === 'structureOnly') draft.structureOnly = f.checked;
      if (f.name === 'shared') draft.shared = f.checked;
      if (f.name === 'theme') (draft.theme = f.value), draw();
    };
    main.onclick = (e) => {
      const lay = e.target.closest('[data-layout]')?.dataset.layout;
      if (lay) return (draft.layout = lay), draw();
      if (e.target.closest('[data-unpic]')) return draft.images.splice(Number(e.target.closest('[data-unpic]').dataset.unpic), 1), draw();
      if (e.target.closest('[data-unzip]')) return (draft.zip = null), draw();
      if (e.target.closest('.np-drop')) $('.np-drop input', main).click();
    };
    main.onkeydown = (e) => e.target.closest?.('.np-drop') && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), $('.np-drop input', main).click());
    main.ondragover = (e) => e.target.closest?.('.np-drop') && e.preventDefault();
    main.ondrop = (e) => e.target.closest?.('.np-drop') && (e.preventDefault(), addFiles([...e.dataTransfer.files]));
    main.onpaste = (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
      if (files.length) e.preventDefault(), addFiles(files);
    };
    main.onsubmit = async (e) => {
      e.preventDefault();
      const kind = e.target.dataset.np;
      const nameField = $('#np-name', main);
      const name = draft.name;
      if (!NAME.test(name)) return error(t('Use lowercase letters, digits and - for the name, starting with a letter or digit.'), nameField);
      if (taken.includes(name)) return error(t('There is already a page called {name}.', { name }), nameField);
      let body;
      if (kind === 'kaity') {
        if (!draft.prompt.trim() && !draft.images.length && !draft.zip) return error(t('Write what the page should be, or add an image of it.'), $('#np-prompt', main));
        body = { name, prompt: draft.prompt.trim(), images: draft.images, ...(draft.zip ? { zip: draft.zip } : {}) };
      } else if (kind === 'copy') {
        if (!/^https?:\/\/[^\s/]+\S*$/i.test(draft.url.trim())) return error(t('Write the address of the page to copy, starting with https://'), $('#np-url', main));
        body = { name, url: draft.url.trim(), structureOnly: draft.structureOnly };
      } else body = { name, layout: draft.layout, shared: draft.shared, ...(site.sharedTheme ? {} : { theme: draft.theme }) };
      for (const b of main.querySelectorAll('[type="submit"]')) b.disabled = true;
      try {
        await request('/_tykerf/site/new', body);
        draft = null;
        location.assign(`/_tykerf/edit/${encodeURIComponent(name)}/`);
      } catch (err) {
        for (const b of main.querySelectorAll('[type="submit"]')) b.disabled = false;
        error(err.message, kind === 'copy' ? $('#np-url', main) : null);
      }
    };
  },
};

export const SCREENS = {
  tasks: tasksScreen, shared: sharedScreen, check: checkScreen, media: mediaScreen, links: linksScreen,
  kaity: kaityScreen, history: historyScreen, settings: settingsScreen, publish: publishScreen, new: newScreen,
};
