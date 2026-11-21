// The one frame of the v4 editor: the same top bar and the same left rail on every screen (the Overview, the site's
// screens, New page, a page in Tasks or Edit). Modes change the centre, never the frame.
//
//   top bar: the mark and where you are (Your site / <screen or page>), the page's modes in the centre, then
//            Kaity ▾ (the Kaity center), Checks, one Undo, one Publish
//   rail:    Pages (with + New page; the open page's blocks under it), Site (the site's screens with their state),
//            Assistant (the Kaity center), Docs and Sign out; docked, folded with its own control, stacked on a phone

import { CHEVRON, DOCS, MARK, esc, hardToReach, kaityMark, keptTwice, request, store, t } from './common.js';

/** Everything the frame says about the site, from the site's endpoints (each may fail on its own). */
export async function siteInfo() {
  const get = (u) => request(u).catch(() => null);
  const [site, tasks, check, kit, media, links, thread] = await Promise.all([
    get('/_tykerf/site'), get('/_tykerf/site/tasks'), get('/_tykerf/site/check'), get('/_tykerf/site/kit'),
    get('/_tykerf/site/media'), get('/_tykerf/site/links'), get('/_tykerf/site/thread'),
  ]);
  return { site, tasks, check, kit, media, links, thread };
}

/** How many things the site's check found: its findings, and the last design check's must-fix ones. */
export const checkCount = (check) => (check?.findings?.length ?? 0) + (check?.design?.fixes ?? 0);

/**
 * The site's check in one state, for the top bar, the rail and the Overview alike (null while unknown): `bad` (n
 * things to see), `unknown` (the design was never checked), `stale` (a page changed after the design check), `good`.
 */
export function checkState(check) {
  if (!check) return null;
  const n = checkCount(check), d = check.design;
  if (n) return { kind: 'bad', n, short: String(n), long: t('Checks: {n} to see', { n }) };
  if (!d) return { kind: 'unknown', n: 0, short: t('not checked yet'), long: t('Checks: not checked yet') };
  if (d.stale) return { kind: 'stale', n: 0, short: t('out of date'), long: t('Checks: out of date') };
  return { kind: 'good', n: 0, short: t('all good'), long: t('Checks: all good') };
}

/** The site's screens in the rail, each with its state now. */
export const SITE_SCREENS = ['overview', 'about', 'shared', 'media', 'links', 'check', 'settings', 'history'];
export function screenStates(info) {
  const { site, check, kit, media, links } = info;
  const blocks = kit?.files?.blocks?.length ?? 0, could = kit?.identical?.length ?? 0;
  const files = media?.files ?? [], twice = keptTwice(files).length;
  const linkCount = links?.links?.filter((l) => !l.broken).length ?? 0, hard = hardToReach(site?.pages, links?.links, site?.home).length;
  const cs = checkState(check);
  return {
    overview: '',
    about: site?.brief && Object.keys(site.brief).length ? t('written') : t('not written yet'),
    shared: could ? t('{n} · {m} could be', { n: blocks, m: could }) : String(blocks),
    media: twice ? t('{n} · {m} twice', { n: files.length, m: twice }) : String(files.length),
    links: linkCount ? (hard ? t('{n} · {m} hard to reach', { n: linkCount, m: hard }) : String(linkCount)) : t('none yet'),
    check: cs?.short ?? '',
    settings: site?.langSet ? site.lang : t('not set'),
    history: '',
  };
}
export const SCREEN_TITLES = {
  overview: () => t('Overview'), about: () => t('About this site'), shared: () => t('Shared blocks'), media: () => t('Media'),
  links: () => t('Links between pages'), check: () => t('Check the site'), settings: () => t('Head code, icon & language'), history: () => t('Site history'),
  kaity: () => t('Kaity center'), tasks: () => t('Every open task on the site'), publish: () => t('Publish'), new: () => t('New page'),
};

const UNDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>';
const WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/></svg>';

/**
 * The top bar. `crumb`: the screen or the page; `centre`: the page's modes and widths (HTML, '' on site screens);
 * `undo`: { label } of what Undo takes back, or null; `kaity`: { count, working, open, waiting }; `checks`: the
 * site's check (checkState; null while unknown). The caller listens for clicks on [data-top] (undo, kaity).
 */
export function renderTop(bar, { crumb, centre = '', undo = null, kaity = { count: 0, working: false, open: false }, checks = null, publishFrom = null, page = null }) {
  // runs waiting for the person (Keep or Undo, a question, an OK): the button counts those first
  const waiting = kaity.waiting ?? 0;
  const kcount = waiting || kaity.count;
  const kname = waiting ? t('Kaity center: {n} waiting for you', { n: waiting }) : t('Kaity center: {n} things she did', { n: kaity.count });
  // a page's sections from the top bar (tasks, Kaity on this page, blocks): a drop-down while the rail is folded
  const pageBtn = page ? `<button type="button" class="btn pbtn" data-top="page" aria-expanded="${!!page.open}" aria-haspopup="true" title="${esc(t('Tasks, Kaity on this page and the blocks'))}">${LIST}<span>${esc(t('This page'))}</span>${page.tasks ? `<span class="tcount">${esc(page.tasks === 1 ? t('1 task') : t('{n} tasks', { n: page.tasks }))}</span>` : ''}${CHEVRON}</button>` : '';
  const undoName = undo ? t('Undo "{step}"', { step: undo.label }) : t('Nothing to undo');
  const from = publishFrom ? `?from=${encodeURIComponent(publishFrom)}` : '';
  bar.innerHTML = `
    <a class="brandlink" href="/_tykerf/edit/_site/" aria-label="${esc(t('tykerf: the site manager'))}">${MARK}<span>tykerf</span></a>
    <nav class="crumb" aria-label="${esc(t('Where you are'))}"><a href="/_tykerf/edit/_site/">${esc(t('Your site'))}</a><span aria-hidden="true">/</span><b>${esc(crumb)}</b></nav>
    <div class="centre">${centre}</div>
    <div class="topacts">
      ${pageBtn}
      <button type="button" class="btn kbtn${waiting ? ' waiting' : ''}" data-top="kaity" aria-expanded="${!!kaity.open}" aria-label="${esc(kname)}" title="${esc(kname)}">${kaityMark(!!kaity.working)}<span>Kaity</span><span class="count">${kcount}</span>${CHEVRON}</button>
      <a class="btn checks ${checks?.kind ?? ''}" href="/_tykerf/edit/_site/check" data-top="checks">${checks?.kind === 'good' || !checks ? CHECK : WARN}<span>${esc(checks?.long ?? t('Checks: …'))}</span></a>
      <button type="button" class="btn icon" data-top="undo" ${undo ? '' : 'disabled'} title="${esc(undoName)}" aria-label="${esc(undoName)}">${UNDO}<span class="vh">${esc(t('Undo'))}</span></button>
      <a class="btn main" href="/_tykerf/edit/_site/publish${from}" data-top="publish">${esc(t('Publish'))}</a>
    </div>`;
}

/**
 * The left rail. On the site's screens: Pages (with + New page), Site (its screens with their state), Assistant (the
 * Kaity center), Docs and Sign out. On a page (v4 round 2: the page is the work, nothing is docked on its right): the
 * page's context, ← Site, its name, Home and address, then `accordion` (sections.js: Tasks, Kaity on this page,
 * Blocks, Site, which holds the rest of the site rail: `siteHTML`). It folds to a strip: on a
 * page, icons for the sections (`onStrip(key)` drops them from the top bar) and back to the site.
 * `screen()`: the site screen shown; `go(screen)`: show a site screen without leaving (site mode); `pageHref(p)`;
 * `pending`: a page being set up (New page); `counts()`: { tasks, kaity } for the strip's badges.
 */
export function createRail({ page = null, screen = () => null, go = null, pageHref = (p) => `/_tykerf/edit/${encodeURIComponent(p)}/`, accordion = null, onKaity = null, onStrip = null, counts = () => ({}), pending = () => null, onChange = () => {} }) {
  const el = document.createElement('nav');
  el.className = `rail${page ? ' paged' : ''}`;
  el.setAttribute('aria-label', page ? t('This page and the site') : t('The site'));
  const head = document.createElement('div');
  head.className = 'rhead-wrap';
  el.append(head);
  if (accordion) el.append(accordion.el);
  let info = null;
  // on a phone the rail stacks above the content, folded to one line until it is opened (not remembered there)
  const narrow = () => matchMedia('(max-width: 900px)').matches;
  let folded = narrow() ? true : store.get('railFolded', false);

  /** The site's part of the rail: its pages, its screens, the Kaity center, the docs (on a page: its Site section). */
  function siteHTML() {
    const s = info?.site;
    const states = info ? screenStates(info) : {};
    const now = screen();
    const kaityN = info?.thread?.items?.length ?? 0, working = !!info?.thread?.running;
    const newHref = `/_tykerf/edit/_site/new${page ? `?from=${encodeURIComponent(page)}` : ''}`;
    const pend = pending();
    const pages = s?.pages ?? [];
    return `
      <div class="rhead"><h2>${esc(t('Pages'))}</h2><a class="btn primary small" href="${newHref}" data-screen="new">${esc(t('+ New page'))}</a></div>
      <ul class="rpages">${pages.map((p) => `<li>
        <a class="rpage" href="${pageHref(p)}" ${p === page ? 'aria-current="page"' : ''}><span>${esc(p)}</span>${p === s.home ? `<span class="hometag">${esc(t('Home'))}</span>` : ''}</a>
      </li>`).join('')}${pend ? `<li><span class="rpage pending" aria-current="page"><span>${esc(pend)}</span><span class="rstate">${esc(t('being set up'))}</span></span></li>` : ''}
      ${!pages.length && !pend ? `<li class="rempty">${esc(t('No pages yet. Your first page becomes the home page.'))}</li>` : ''}</ul>
      <h2>${esc(t('Site'))}</h2>
      <ul class="rlist">${(pages.length ? SITE_SCREENS : ['overview', 'about', 'settings', 'history']).map((k) => `<li><a href="/_tykerf/edit/_site/${k === 'overview' ? '' : k}" data-screen="${k}" ${now === k ? 'aria-current="page"' : ''}><span>${esc(SCREEN_TITLES[k]())}</span>${states[k] ? `<span class="rstate${k === 'check' ? ` ${checkState(info?.check)?.kind ?? ''}` : ''}">${esc(states[k])}</span>` : ''}</a></li>`).join('')}</ul>
      <h2>${esc(t('Assistant'))}</h2>
      <ul class="rlist"><li><a href="/_tykerf/edit/_site/kaity${page ? `?from=${encodeURIComponent(page)}` : ''}" data-kaity ${now === 'kaity' ? 'aria-current="page"' : ''}>${kaityMark(working, true)}<span>${esc(t('Kaity center'))}</span><span class="rstate">${kaityN || ''}</span></a></li></ul>
      <div class="rfoot"><a class="btn small" href="${DOCS}/README.md" target="_blank" rel="noopener">${esc(t('Docs'))}</a>${s?.signin ? `<button type="button" class="btn small" data-rail="signout">${esc(t('Sign out'))}</button>` : ''}</div>`;
  }

  function render() {
    el.classList.toggle('folded', folded);
    document.body.classList.toggle('rail-folded', folded);
    if (accordion) accordion.el.hidden = folded;
    if (folded && page) {
      // the strip: unfold, the page's sections (from the top bar's drop-down), back to the site
      const c = counts();
      const icon = (key, label, svg, n = 0) => `<button type="button" class="ricon" data-strip="${key}" aria-label="${esc(label)}" title="${esc(label)}">${svg}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
      head.innerHTML = `<div class="rstrip">
        <button type="button" class="ricon" data-rail="unfold" aria-expanded="false" aria-label="${esc(t('Open the side panel'))}" title="${esc(t('Open the side panel'))}">${UNFOLD}</button>
        ${icon('tasks', t('Tasks on this page'), LIST, c.tasks)}
        ${icon('kaity', t('Kaity on this page'), kaityMark(false, true), c.kaity)}
        ${icon('blocks', t('Blocks'), BLOCKS)}
        <a class="ricon" href="/_tykerf/edit/_site/" aria-label="${esc(t('Back to the site'))}" title="${esc(t('Back to the site'))}">${BACK}</a>
      </div>`;
      return;
    }
    if (folded) {
      head.innerHTML = `<button type="button" class="rfold" data-rail="unfold" aria-expanded="false" aria-label="${esc(t('Open the side panel: pages and the site'))}" title="${esc(t('Open the side panel'))}">›<span>${esc(t('Pages and the site'))}</span></button>`;
      return;
    }
    if (page) {
      const s = info?.site;
      head.innerHTML = `
        <div class="rtop"><a class="rback" href="/_tykerf/edit/_site/">${BACK}<span>${esc(t('Site'))}</span></a>
          <button type="button" class="ricon fold" data-rail="fold" aria-expanded="true" aria-label="${esc(t('Fold the side panel'))}" title="${esc(t('Fold the side panel: the page takes the whole width'))}">${FOLD}</button></div>
        <p class="rpname"><b>${esc(page)}</b>${s && page === s.home ? `<span class="hometag">${esc(t('Home'))}</span>` : ''}<code>/${esc(page)}/</code></p>`;
      accordion?.render();
      return;
    }
    head.innerHTML = `<button type="button" class="rfold" data-rail="fold" aria-expanded="true" aria-label="${esc(t('Fold the side panel'))}" title="${esc(t('Fold the side panel'))}">‹</button>${siteHTML()}`;
  }

  async function setFolded(v) {
    folded = v;
    if (!narrow()) store.set('railFolded', folded);
    render();
    onChange();
  }

  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-rail]')?.dataset.rail;
    if (r === 'fold' || r === 'unfold') {
      await setFolded(r === 'fold');
      if (!folded) el.querySelector('[data-rail="fold"]')?.focus();
      return;
    }
    if (r === 'signout') {
      await request('/_tykerf/logout', {}).catch(() => {});
      try { localStorage.removeItem('tykerf.admin'); } catch {}
      return location.assign('/');
    }
    const strip = e.target.closest('[data-strip]')?.dataset.strip;
    if (strip && onStrip) return onStrip(strip, e.target.closest('[data-strip]'));
    if (e.target.closest('[data-kaity]') && onKaity) return e.preventDefault(), onKaity();
    const sc = e.target.closest('[data-screen]')?.dataset.screen;
    if (sc && go) return e.preventDefault(), go(sc);
  });

  return {
    el,
    async refresh() {
      info = await siteInfo();
      render();
      return info;
    },
    render,
    siteHTML,
    get info() {
      return info;
    },
    isFolded: () => folded,
    /** Unfold it (Pin to the side panel, Details on a block); `then` once it shows. */
    unfold: () => (folded ? setFolded(false) : undefined),
  };
}

const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16M20 12H9M14 7l-5 5 5 5"/></svg>';
const UNFOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/></svg>';
const BLOCKS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="18" height="8" rx="1.5"/></svg>';

/** The page's modes in the top bar's centre: Tasks · Edit · View and (?), the mode's hint again; then its width. */
export function pageModes({ page, mode, device, devices }) {
  const enc = encodeURIComponent(page);
  const link = (m, href, label, extra = '') => `<a href="${href}" ${mode === m ? 'aria-current="page"' : ''} ${extra}>${label}</a>`;
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const modes = `<nav class="modes" aria-label="${esc(t('Mode'))}">
    ${link('tasks', `/_tykerf/edit/${enc}/`, esc(t('Tasks')))}
    ${link('edit', `/_tykerf/edit/${enc}/?mode=full`, esc(t('Edit')), `title="${esc(t('Every block in detail: the box tree, text, code, sizes, look and the page\'s theme'))}"`)}
    ${link('view', `/_tykerf/edit/${enc}/?mode=view`, `${eye}${esc(t('View'))}`, `title="${esc(t('The page as visitors see it: links, buttons and forms work'))}"`)}
  </nav><button type="button" class="mhelp" data-top="help" aria-label="${esc(t('What you do in this mode'))}" title="${esc(t('What you do in this mode'))}">?</button>`;
  const widths = devices ? `<div class="widths" role="group" aria-label="${esc(t('The page\'s width'))}">${Object.entries(devices).map(([k, d]) =>
    `<button type="button" data-device="${k}" aria-pressed="${device === k}" aria-label="${esc(d.label())}" title="${esc(d.label())}"><svg viewBox="0 0 24 24" aria-hidden="true">${d.icon}</svg><span class="size">${esc(d.short())}</span></button>`).join('')}</div>` : '';
  return modes + widths;
}
