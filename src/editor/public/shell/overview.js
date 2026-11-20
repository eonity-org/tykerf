// The site manager's Overview (v4, /_tykerf/edit/_site/): where the editor opens and where every "back" leads. The
// site's pages as cards, New page, what to look at before publishing, Kaity's latest work with a composer, and the
// guides. A site with no pages shows the first run instead: what tykerf is, the guides, and three ways to start.

import { DOC_CARD, DOC_LINKS, docLink, esc, failed, hardToReach, kaityMark, request, t, toast, when } from './common.js';
import { createComposer } from './composer.js';
import { askKaity, loadThread, scopeChip } from './kaity.js';

const edit = (p) => `/_tykerf/edit/${encodeURIComponent(p)}/`;
const DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/></svg>';
const OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
const PAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>';

let acting = null; // { page, what: 'name' | 'remove' | 'more', links? }: a card's open form or confirmation

/** Who made the last change, in words. */
const byWhom = (c) => (!c ? '' : c.author === 'ai' ? t('Changed {when} by Kaity', { when: when(c.at) }) : t('Changed {when} by you', { when: when(c.at) }));

function pageCard(p, info) {
  const { site, tasks } = info;
  const home = site.home === p;
  const open = tasks?.pages?.find((x) => x.page === p)?.tasks.length ?? 0;
  const title = site.titles?.[p] ?? '';
  const meta = [byWhom(site.changed?.[p]), open === 1 ? t('1 open task') : t('{n} open tasks', { n: open })].filter(Boolean).join(' · ');
  const form = acting?.page !== p ? '' : acting.what === 'name' ? `
    <form class="pform" data-page="${esc(p)}">
      <label>${esc(t('Name (its address)'))}<input name="to" value="${esc(p)}" pattern="[a-z0-9][a-z0-9-]*" required></label>
      <label>${esc(t('Title (in the browser tab and search results)'))}<input name="title" value="${esc(site.ownTitles?.[p] ?? '')}" placeholder="${esc(title)}"></label>
      <div class="row"><button class="btn primary small" type="submit">${esc(t('Save'))}</button><button class="btn small" type="button" data-pact="cancel">${esc(t('Cancel'))}</button></div>
    </form>` : acting.what === 'remove' ? `
    <div class="confirm" role="alert"><p>${esc(t('Remove {page}? It goes to the site\'s trash, and links to it stop working.', { page: p }))}</p>
      <p class="hint">${esc(linksTo(p))}</p>
      <div class="row"><button class="btn small danger" type="button" data-pact="remove-yes">${esc(t('Remove {page}', { page: p }))}</button><button class="btn small" type="button" data-pact="cancel">${esc(t('Cancel'))}</button></div></div>` : acting.what === 'more' ? `
    <div class="pmore" role="menu">${home ? '' : `<button type="button" role="menuitem" data-pact="home">${esc(t('Make it home'))}</button>`}<button type="button" role="menuitem" class="danger" data-pact="remove">${esc(t('Remove…'))}</button></div>` : '';
  return `<article class="ocard" data-page="${esc(p)}">
    <a class="othumb" href="${edit(p)}" tabindex="-1" aria-hidden="true"><iframe src="/${encodeURIComponent(p)}/?tykerf=frame" loading="lazy" sandbox="allow-same-origin" scrolling="no" tabindex="-1" title=""></iframe></a>
    <h3><a href="${edit(p)}">${esc(p)}</a> <span class="addr">/${esc(p)}/</span>${home ? `<span class="hometag">${esc(t('Home'))}</span>` : ''}</h3>
    ${title && title !== p ? `<p class="otitle">${esc(title)}</p>` : ''}
    <p class="note">${esc(meta)}</p>
    <div class="row">
      <a class="btn primary small" href="${edit(p)}">${esc(t('Open'))}</a>
      <a class="btn small" href="/_tykerf/view?page=${encodeURIComponent(p)}">${EYE}${esc(t('View'))}</a>
      <button type="button" class="btn small" data-pact="name">${esc(t('Name and title'))}</button>
      <button type="button" class="btn small" data-pact="duplicate">${esc(t('Duplicate'))}</button>
      <button type="button" class="btn small" data-pact="more" aria-haspopup="menu" aria-expanded="${acting?.page === p && acting.what === 'more'}" aria-label="${esc(t('More for {page}', { page: p }))}">⋯</button>
    </div>${form}
  </article>`;
}

/** What removing a page breaks: the links to it from the other pages. */
function linksTo(p) {
  const mine = (acting?.links ?? []).filter((l) => l.to === p && l.page !== p);
  const from = [...new Set(mine.map((l) => l.page))].join(', ');
  return mine.length === 1 ? t('One link to it from {pages} will point nowhere.', { pages: from })
    : mine.length ? t('{n} links to it from {pages} will point nowhere.', { n: mine.length, pages: from }) : t('No other page links to it.');
}

/** Before you publish: the site's check in four lines, each with what to do about it. */
function beforePublish(info) {
  const { site, check, links } = info;
  const row = (label, state, action = '', bad = false) => `<li><span>${esc(label)}</span><span class="pstate${bad ? ' bad' : ''}">${esc(state)}</span>${action}</li>`;
  const go = (screen, label) => `<a class="link" href="/_tykerf/edit/_site/${screen}" data-screen="${screen}">${esc(label)}</a>`;
  const d = check?.design;
  const brief = site.brief && Object.keys(site.brief).length;
  const good = links?.links?.filter((l) => !l.broken && l.to !== l.page) ?? [];
  const hard = hardToReach(site.pages, links?.links, site.home);
  const others = (check?.findings ?? []).filter((f) => f.kind !== 'lang').length;
  return `<section class="ocheck"><h2>${esc(t('Before you publish'))}</h2><p class="note">${esc(t('What visitors and search engines will notice.'))}</p>
    <ul>
      ${d ? row(t('Design check'), d.fixes ? t('{n} to fix', { n: d.fixes }) : t('All good'), d.fixes ? go('check', t('Review')) : '', !!d.fixes) : row(t('Design check'), t('Not checked yet'), go('check', t('Check')))}
      ${row(t('About this site'), brief ? t('Written') : t('Not written yet'), go('about', brief ? t('Change') : t('Write it')))}
      ${row(t('Links between pages'), !good.length ? t('None yet') : hard.length ? t('{n} hard to reach', { n: hard.length }) : t('Every page can be reached'), go('links', t('Review')), !!hard.length)}
      ${row(t('Language'), site.langSet ? site.lang : t('Not set'), site.langSet ? '' : go('settings', t('Set it')), !site.langSet)}
      ${others ? row(t('Other checks'), others === 1 ? t('1 thing to look at') : t('{n} things to look at', { n: others }), go('check', t('Review')), true) : ''}
    </ul></section>`;
}

/** Kaity lately: her last three runs, newest first, and the composer for the whole site. */
function kaityLately(thread) {
  const last = (thread?.items ?? []).slice(-3).reverse();
  const title = (r) => (r.kind === 'task' ? t('Task {n}', { n: r.task }) + (r.answer ? ` — ${r.answer.split(/(?<=[.!?])\s/)[0]}` : '') : r.kind === 'ask' ? r.request : r.answer || r.request);
  return `<section class="olately"><header><h2>${esc(t('Kaity lately'))}</h2><a class="link" href="/_tykerf/edit/_site/kaity" data-open-kaity>${esc(t('Open Kaity center'))}</a></header>
    ${last.length ? `<ul>${last.map((r) => `<li>${kaityMark(r.state === 'working', true)}<div><p class="emeta">${scopeChip(r)}<span>${esc([when(r.ended ?? r.at), r.steps ? (r.steps === 1 ? t('1 step') : t('{n} steps', { n: r.steps })) : ''].filter(Boolean).join(' · '))}</span></p><p class="etitle">${esc(String(title(r)).slice(0, 140))}</p></div></li>`).join('')}</ul>`
      : `<p class="empty">${esc(t('Nothing yet. Ask her about the whole site below, or open a page and ask about it.'))}</p>`}
    <div class="olcomposer"></div></section>`;
}

const learn = () => `<aside class="olearn">${DOC}<b>${esc(t('Learn tykerf'))}</b>${DOC_LINKS().map(([f, l]) => `<a href="${docLink(f)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}<span class="note">${esc(t('Opens the online docs'))} ${OUT}</span></aside>`;

/** The first run: a site with no pages. */
function firstRun() {
  const start = (kind, icon, title, text, rec = false) => `<a class="ostart${rec ? ' rec' : ''}" href="/_tykerf/edit/_site/new?start=${kind}" data-start="${kind}">${rec ? `<span class="recommended">${esc(t('Recommended'))}</span>` : ''}${icon}<h3>${esc(title)}</h3><p>${esc(text)}</p></a>`;
  return `<div class="ofirst">
    <div class="ointro">
      <p class="eyebrow">${esc(t('Welcome to tykerf'))}</p>
      <h1>${esc(t('Build your site page by page, with Kaity at your side'))}</h1>
      <p class="lead">${esc(t('tykerf edits plain HTML pages made of blocks: rows, columns and boxes. Kaity, the assistant, builds and changes them when you ask. Every change can be undone, and nothing goes live until you publish.'))}</p>
      <ol class="osteps">
        <li><b>${esc(t('Create your first page'))}</b><span>${esc(t('It becomes the home page. You can rename or replace it later.'))}</span></li>
        <li><b>${esc(t('Click anything on it and say what should change'))}</b><span>${esc(t('Each request becomes a task. Do it yourself in the editor, or give it to Kaity.'))}</span></li>
        <li><b>${esc(t('Check and publish'))}</b><span>${esc(t('tykerf checks the site for problems, then publishes it as static files.'))}</span></li>
      </ol>
    </div>
    <aside class="odocs"><h2>${DOC}${esc(t('Documentation'))}</h2><p class="note">${esc(t('Short guides, online.'))}</p>
      <ul>${DOC_CARD().map(([f, l]) => `<li><a href="${docLink(f)}" target="_blank" rel="noopener"><span>${esc(l)}</span>${OUT}</a></li>`).join('')}</ul></aside>
  </div>
  <h2>${esc(t('Create your first page'))}</h2>
  <p class="lead">${esc(t('Pick how you want to start. You can mix them: start from a kind of page, then ask Kaity to fill it.'))}</p>
  <div class="ostarts">
    ${start('describe', `<span class="kmark">${kaityMark(false, true)}</span>`, t('Describe it to Kaity'), t('Answer a few questions, add a screenshot or a PDF, and watch her build it.'), true)}
    ${start('kind', LIST, t('Start from a kind of page'), t('Choose what the page is, how it is held together and a theme, with a live preview.'))}
    ${start('copy', PAGE, t('Copy a web page'), t('tykerf cuts an existing page into rows, columns and boxes as a starting point.'))}
  </div>`;
}

/** Thumbnails: each page laid out at 1440 px, shown at its card's width. */
function fitThumbs(main) {
  for (const th of main.querySelectorAll('.othumb')) {
    const f = th.querySelector('iframe');
    if (f) f.style.transform = `scale(${th.clientWidth / 1440})`;
  }
}

export const overviewScreen = {
  title: () => t('Overview'),
  async render(main, ctx) {
    const get = (u) => request(u).catch(() => null);
    const [site, tasks, check, kit, media, links, thread] = await Promise.all([
      get('/_tykerf/site'), get('/_tykerf/site/tasks'), get('/_tykerf/site/check'), get('/_tykerf/site/kit'), get('/_tykerf/site/media'), get('/_tykerf/site/links'), loadThread().catch(() => null),
    ]);
    if (!site) return void (main.innerHTML = `<p class="note bad">${esc(t('The site could not be read.'))}</p>`);
    const info = { site, tasks, check, kit, media, links, thread };
    if (!site.pages.length) {
      main.innerHTML = firstRun();
      ctx.setTitle?.(t('Welcome'));
      return;
    }
    const nBlocks = kit?.files?.blocks?.length ?? 0, nFiles = media?.files?.length ?? 0;
    const counts = [
      site.pages.length === 1 ? t('1 page') : t('{n} pages', { n: site.pages.length }),
      nBlocks === 1 ? t('1 shared block') : t('{n} shared blocks', { n: nBlocks }),
      nFiles === 1 ? t('1 media file') : t('{n} media files', { n: nFiles }),
      site.langSet ? t('language {lang}', { lang: site.lang }) : t('language not set'),
    ].join(' · ');
    main.innerHTML = `
      <header class="ohead"><div><h1>${esc(t('Your site'))}</h1><p class="note">${esc(counts)}</p></div>
        <div class="row"><a class="btn" href="/_tykerf/view">${EYE}${esc(t('View site'))}</a><a class="btn primary" href="/_tykerf/edit/_site/new" data-screen="new">${esc(t('+ New page'))}</a></div></header>
      <h2>${esc(t('Pages'))}</h2>
      <div class="ocards">${site.pages.map((p) => pageCard(p, info)).join('')}
        <a class="ocard onew" href="/_tykerf/edit/_site/new" data-screen="new"><span class="plus" aria-hidden="true">+</span><h3>${esc(t('New page'))}</h3><p class="note">${esc(t('Describe it to Kaity, start from a kind of page, or copy one.'))}</p></a>
      </div>
      <div class="otwo">${beforePublish(info)}${kaityLately(thread)}</div>
      ${learn()}`;
    const composer = createComposer({
      compact: true,
      label: t('Ask Kaity about the whole site'),
      placeholder: () => t('Ask Kaity about the whole site…'),
      submit: () => t('Ask'),
      send: async (m) => {
        await askKaity({ ...m, scope: 'site' });
        toast(t('Kaity is on it'));
        ctx.openKaity?.();
      },
    });
    main.querySelector('.olcomposer').append(composer.el);
    fitThumbs(main);
    main.onclick = async (e) => {
      if (e.target.closest('[data-open-kaity]') && ctx.openKaity) return e.preventDefault(), ctx.openKaity();
      const sc = e.target.closest('[data-screen]')?.dataset.screen;
      if (sc) return e.preventDefault(), ctx.go(sc);
      const b = e.target.closest('[data-pact]');
      if (!b) return;
      const p = b.closest('[data-page]').dataset.page;
      const what = b.dataset.pact;
      try {
        if (what === 'cancel') acting = null;
        else if (what === 'name') acting = { page: p, what };
        else if (what === 'more') acting = acting?.page === p && acting.what === 'more' ? null : { page: p, what };
        else if (what === 'remove') acting = { page: p, what, links: (await request('/_tykerf/site/links').catch(() => ({ links: [] }))).links };
        else if (what === 'home') (acting = null), await request('/_tykerf/site/home', { name: p }), toast(t('{page} is the home page now', { page: p }));
        else if (what === 'duplicate') {
          const r = await request('/_tykerf/site/duplicate', { name: p });
          toast(t('{page} is a copy of {from}', { page: r.name, from: p }));
        } else if (what === 'remove-yes') {
          await request('/_tykerf/site/remove', { name: p });
          acting = null;
          toast(t('{page} is in the site\'s trash', { page: p }));
        }
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
    main.onsubmit = async (e) => {
      const f = e.target;
      if (!f.classList.contains('pform')) return;
      e.preventDefault();
      const p = f.dataset.page, to = f.elements.to.value.trim(), title = f.elements.title.value.trim();
      try {
        if (title !== (site.ownTitles?.[p] ?? '')) await request('/_tykerf/site/title', { name: p, title });
        if (to !== p) await request('/_tykerf/site/rename', { name: p, to });
        acting = null;
        await ctx.refresh();
      } catch (err) {
        failed(err);
      }
    };
    overviewScreen.resize = () => fitThumbs(main);
  },
};
