// One Kaity (v4): everything she was asked and did, on the whole site and on every page, as one thread from the
// oldest to the newest (/_tykerf/site/thread, from her log). The Kaity center is a drawer from the top bar's Kaity
// button on every screen; "Open as page" shows the same at /_tykerf/edit/_site/kaity; a page's "Kaity on this page"
// and the Overview's "Kaity lately" are the same thread, filtered. Runs she was asked for in words show as the
// person's message and her answer; task runs and her own passes show as compact events. Each can be undone.

import { $, esc, failed, kaityMark, plainLabel, request, store, t, toast, when } from './common.js';
import { createComposer, fileChip } from './composer.js';
import { markdown } from '../markdown.js';

/** Longer than this, a message the person sent folds to a few lines (a pasted profile, say). */
const FOLD = 600;

/** The thread, oldest first: { items, pages, running }. */
export const loadThread = () => request('/_tykerf/site/thread');

/** Where a run was: the whole site, a page, or a block of a page. */
export function scopeChip(r) {
  // (runs logged before scopes were: one with a block was on that block)
  const box = r.scope ? r.scope === 'box' : !!r.block;
  const text = !r.page ? t('Whole site') : box && r.block ? `${r.page} · ${r.block}` : r.page;
  return `<span class="scopechip${!r.page ? ' site' : ''}">${esc(text)}</span>`;
}

/** Her answer's first sentence, short: the title of an event. */
function gist(text, n = 110) {
  const s = String(text ?? '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(s)?.[1] ?? s;
  return first.length > n ? `${first.slice(0, n - 1)}…` : first;
}

const fileUrl = (r, f) => (r.page ? `/${encodeURIComponent(r.page)}/_tykerf/image/${encodeURIComponent(f.file)}` : `/_tykerf/site/image/${encodeURIComponent(f.file)}`);
const steps = (n) => (n ? (n === 1 ? t('1 step') : t('{n} steps', { n })) : '');

/** A day's heading between the messages: Today, Yesterday, or the date. */
function dayOf(at) {
  const d = new Date(at), today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('Today');
  if (d.toDateString() === y.toDateString()) return t('Yesterday');
  return d.toLocaleDateString();
}
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What the person sent: folded when it is long, with its files. */
function youSaid(r, open) {
  const long = r.request.length > FOLD;
  return `<li class="ti you" data-run="${esc(r.run)}">
    <p class="who"><b>${esc(t('You'))}</b>${scopeChip(r)}<span class="when">${esc(clock(r.at))}</span></p>
    <p class="req${long && !open ? ' folded' : ''}">${esc(r.request)}</p>
    ${long ? `<button type="button" class="link" data-unfold="${esc(r.run)}">${esc(open ? t('Show less') : t('Pasted text · {n} characters · Show all', { n: r.request.length.toLocaleString() }))}</button>` : ''}
    ${r.files?.length ? `<div class="files">${r.files.map((f) => `<a class="fchip" href="${fileUrl(r, f)}" target="_blank" rel="noopener">${esc(f.name ?? f.file)}</a>`).join('')}</div>` : ''}
  </li>`;
}

const undoBtn = (r) => (r.undoable ? `<button type="button" class="link" data-undo-run="${esc(r.run)}">${esc(t('Undo'))}</button>` : r.undone ? `<span class="note">${esc(t('Undone'))}</span>` : '');
const stopBtn = (r) => `<button type="button" class="btn small" data-stop="${esc(r.page ?? '')}">${esc(t('Stop Kaity'))}</button>`;

/** Her side: working now, her answer, or why she stopped. */
function kaitySaid(r) {
  const head = `<p class="who">${kaityMark(r.state === 'working', true)}<b>Kaity</b>${scopeChip(r)}<span class="when">${esc(clock(r.ended ?? r.at))}${r.steps ? ` · ${esc(steps(r.steps))}` : ''}</span></p>`;
  if (r.state === 'working') return `<li class="ti her working">${head}<p class="note" data-live="${esc(r.page ?? '')}">${esc(r.step ?? t('Starting…'))}</p><div class="row">${stopBtn(r)}</div></li>`;
  const why = r.state === 'cut short' ? t('Cut short: tykerf stopped while she worked.') : r.state === 'stopped' ? t('Stopped.') : r.state === 'unfinished' ? t('She stopped before she finished: {why}', { why: r.error ?? '' }) : r.error ?? '';
  return `<li class="ti her">${head}
    ${r.answer ? `<div class="md">${markdown(r.answer)}</div>` : ''}${why ? `<p class="note${r.state === 'failed' ? ' bad' : ''}">${esc(why)}</p>` : ''}
    <div class="row">${undoBtn(r)}${r.page && r.block ? `<a class="link" href="/_tykerf/edit/${encodeURIComponent(r.page)}/?conversation=${encodeURIComponent(r.block)}">${esc(t('Her conversation on {block}', { block: r.block }))}</a>` : ''}</div></li>`;
}

/** A run she wasn't asked for in words (a task, finishing what she left, going on): one compact line. */
function eventLine(r) {
  const title = r.kind === 'task' ? t('Task {n}: {what}', { n: r.task, what: gist(r.answer || r.request) })
    : r.kind === 'fix' ? t('Finished what was left: {what}', { what: gist(r.answer || '…') })
    : t('Went on: {what}', { what: gist(r.answer || '…') });
  const ok = r.state === 'done' && !r.undone;
  return `<li class="ti event${r.state === 'working' ? ' working' : ''}">
    <span class="tick${ok ? ' ok' : ''}" aria-hidden="true">${r.state === 'working' ? kaityMark(true, true) : ok ? '✓' : '·'}</span>
    <div><p class="etitle">${esc(title)}</p><p class="emeta">${scopeChip(r)}<span>${esc(r.state === 'working' ? r.step ?? t('working') : [when(r.ended ?? r.at), steps(r.steps)].filter(Boolean).join(' · '))}</span></p></div>
    <div class="eacts">${r.state === 'working' ? stopBtn(r) : undoBtn(r)}</div>
  </li>`;
}

/** The thread's items as a list, oldest first, with a heading for each day. */
export function threadHTML(items, { unfolded = new Set() } = {}) {
  if (!items.length) return `<p class="empty">${esc(t('Nothing yet. Ask Kaity below: she can change one box, a whole page or the whole site, and every change can be undone.'))}</p>`;
  let day = '';
  const out = [];
  for (const r of items) {
    const d = dayOf(r.at);
    if (d !== day) out.push(`<li class="day"><span>${esc(d)}</span></li>`), (day = d);
    if (r.kind === 'ask') out.push(youSaid(r, unfolded.has(r.run)), kaitySaid(r));
    else out.push(eventLine(r));
  }
  return `<ol class="thread">${out.join('')}</ol>`;
}

/** Every open task on the site, page by page (the old "Every open task" screen, as a filter of the thread). */
async function tasksHTML() {
  const r = await request('/_tykerf/site/tasks');
  const pages = r.pages.filter((x) => x.tasks.length || x.run);
  const working = r.queue[0] ?? r.pages.find((x) => x.run?.running)?.page ?? null;
  if (!pages.length) return `<p class="empty">${esc(t('No open tasks. Open a page, click anything on it and say what should change.'))}</p>`;
  return `<div class="give">${working ? `<p class="working">${kaityMark(true, true)} ${esc(t('Kaity is working on {page}.', { page: working }))}</p><button type="button" class="btn" data-tasks="stop">${esc(t('Stop Kaity'))}</button>`
    : `<button type="button" class="btn main" data-tasks="all">${esc(t('Give Kaity everything'))}</button>`}<p class="scope">${esc(t('She works page by page, one task at a time, and only in the box each task points at.'))}</p></div>
    ${pages.map((x) => `<section class="group" data-page="${esc(x.page)}"><header><h3>${esc(x.page)}</h3><span class="spacer"></span>
      <a class="btn small" href="/_tykerf/edit/${encodeURIComponent(x.page)}/">${esc(t('Open the page'))}</a>${x.tasks.length ? `<button type="button" class="btn small" data-tasks="page" ${working ? 'disabled' : ''}>${esc(t('Give Kaity this page'))}</button>` : ''}</header>
      <ul class="trows">${x.tasks.map((k) => `<li class="trow"><span class="num${k.kind === 'question' ? ' q' : ''}">${k.kind === 'question' ? esc(t('Question')) : k.n}</span><span class="twhere"><b>${esc(k.block)}</b> ${esc(plainLabel(k.label))}</span><span class="ttext">${esc(k.text)}</span></li>`).join('')}</ul></section>`).join('')}`;
}

/** Everything the person sent to Kaity from a composer: to the whole site, or to a page (one box, or the whole page). */
export async function askKaity({ prompt, files, scope }, { page = null, box = null } = {}) {
  if (scope === 'site' || !page) return request('/_tykerf/site/ask', { prompt, files });
  return request(`/${encodeURIComponent(scope.startsWith('page:') ? scope.slice(5) : page)}/_tykerf/ask`, { prompt, files, scope: scope === 'box' ? 'box' : 'page', id: scope === 'box' ? box : '' });
}

/**
 * The thread with its filters and composer: in the drawer (`full` false) or full width (the Kaity screen). `page`:
 * the page open, if any (its filter and its composer scope come first). `onAsked`: after something was sent.
 */
export function createThreadView({ full = false, page = null, filter = null, onAsked = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = `kview${full ? ' full' : ''}`;
  const S = { data: null, filter: filter ?? store.get('kaityFilter', 'all'), unfolded: new Set() };
  if (page && !filter) S.filter = 'all';
  const list = document.createElement('div');
  list.className = 'kscroll';
  const filters = document.createElement('div');
  filters.className = 'kfilters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', t('Show'));
  const pagesFor = () => S.data?.pages ?? (page ? [page] : []);
  const composer = createComposer({
    scopes: [],
    placeholder: (s) => (!s || s === 'site' ? t('Ask Kaity about the whole site…') : t('Ask Kaity about {page}…', { page: s.slice(5) })),
    send: async (m) => {
      await askKaity(m, { page });
      toast(t('Kaity is on it'));
      onAsked(m);
      await reload();
    },
  });
  function scopes() {
    const ps = page ? [page] : pagesFor().slice(0, 3);
    composer.setScopes([{ key: 'site', label: t('Whole site') }, ...ps.map((p) => ({ key: `page:${p}`, label: p }))], page ? `page:${page}` : 'site');
  }
  el.append(filters, list, composer.el);

  function shown() {
    const items = S.data?.items ?? [];
    if (S.filter === 'all') return items;
    if (S.filter === 'site') return items.filter((r) => !r.page);
    return items.filter((r) => r.page === S.filter);
  }
  async function render() {
    const ps = pagesFor();
    const opts = [['all', t('Everything')], ['site', t('Whole site')], ...ps.map((p) => [p, p]), ['tasks', t('Tasks')]];
    filters.innerHTML = `<span>${esc(t('Show'))}</span>${opts.map(([k, l]) => `<button type="button" data-filter="${esc(k)}" aria-pressed="${S.filter === k}">${esc(l)}</button>`).join('')}`;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = S.filter === 'tasks' ? await tasksHTML().catch((e) => `<p class="note bad">${esc(e.message)}</p>`) : threadHTML(shown(), { unfolded: S.unfolded });
    composer.el.hidden = S.filter === 'tasks';
    if (atBottom || !S.rendered) list.scrollTop = list.scrollHeight;
    S.rendered = true;
  }
  async function reload() {
    try {
      S.data = await loadThread();
    } catch (e) {
      return failed(e);
    }
    scopes();
    await render();
  }

  el.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) {
      S.filter = f;
      if (!page) store.set('kaityFilter', f);
      S.rendered = false;
      return render();
    }
    const un = e.target.closest('[data-unfold]')?.dataset.unfold;
    if (un) return S.unfolded.has(un) ? S.unfolded.delete(un) : S.unfolded.add(un), render();
    const undo = e.target.closest('[data-undo-run]')?.dataset.undoRun;
    if (undo) {
      try {
        const r = await request('/_tykerf/site/kaity/undo', { run: undo });
        toast(r.result === 1 ? t('Undone: 1 change she made') : t('Undone: {n} changes she made', { n: r.result }));
      } catch (err) {
        failed(err);
      }
      return reload();
    }
    const stop = e.target.closest('[data-stop]');
    if (stop) return request(stop.dataset.stop ? `/${encodeURIComponent(stop.dataset.stop)}/_tykerf/ask/cancel` : '/_tykerf/site/ask/cancel', {}).catch(failed);
    const tk = e.target.closest('[data-tasks]')?.dataset.tasks;
    try {
      if (tk === 'all') await request('/_tykerf/site/tasks/give', {});
      if (tk === 'stop') await request('/_tykerf/site/tasks/stop', {});
      if (tk === 'page') await request('/_tykerf/site/tasks/give', { pages: [e.target.closest('[data-page]').dataset.page] });
      if (tk) await render();
    } catch (err) {
      failed(err);
    }
  });

  return {
    el,
    reload,
    composer,
    /** A step of the run going on (on that page, '' for the whole site): its line follows without drawing it all again. */
    step(page, text) {
      for (const live of list.querySelectorAll(`[data-live="${CSS.escape(page ?? '')}"]`)) live.textContent = text;
    },
    setFilter(f) {
      S.filter = f;
      S.rendered = false;
      return render();
    },
  };
}

/** The site's live news (her runs on any page and on the whole site), for whoever shows the thread. */
let events = null;
const listeners = new Set();
export function onKaityNews(fn) {
  listeners.add(fn);
  if (!events) {
    events = new EventSource('/_tykerf/site/events');
    const tell = (kind) => (e) => {
      let data = null;
      try { data = JSON.parse(e.data); } catch {}
      for (const l of listeners) l(kind, data);
    };
    events.addEventListener('ai', tell('ai'));
    events.addEventListener('taskrun', tell('taskrun'));
  }
  return () => listeners.delete(fn);
}

/**
 * The Kaity center: a drawer from the top bar's Kaity button, on every screen. `page`: the page open behind it.
 * `onToggle(open)`: the top bar marks its button.
 */
export function createKaityCenter({ page = null, onToggle = () => {} } = {}) {
  const el = document.createElement('aside');
  el.className = 'kcenter';
  el.hidden = true;
  el.setAttribute('aria-label', t('Kaity center'));
  const view = createThreadView({ page });
  el.innerHTML = `<header class="khead">${kaityMark(false, true)}<h2>${esc(t('Kaity center'))}</h2><span class="ksum"></span>
    <a class="btn small" href="/_tykerf/edit/_site/kaity${page ? `?from=${encodeURIComponent(page)}` : ''}">${esc(t('Open as page'))}</a>
    <button type="button" class="btn small icon" data-kc="close" aria-label="${esc(t('Close the Kaity center'))}">×</button></header>`;
  el.append(view.el);
  document.body.append(el);
  async function reload() {
    await view.reload();
  }
  let soon = 0;
  onKaityNews((kind, m) => {
    if (el.hidden) return;
    if (kind === 'ai' && m?.role === 'step') return view.step(m.page ?? '', m.text);
    clearTimeout(soon);
    soon = setTimeout(() => void reload().then(summary), 250);
  });
  async function summary() {
    const d = await loadThread().catch(() => null);
    if (!d) return;
    const done = d.items.filter((r) => r.state !== 'working').length;
    $('.ksum', el).textContent = t('{n} running · {m} done', { n: d.running, m: done });
  }
  el.addEventListener('click', (e) => e.target.closest('[data-kc="close"]') && api.close());
  el.addEventListener('keydown', (e) => e.key === 'Escape' && api.close());
  const api = {
    el,
    isOpen: () => !el.hidden,
    async open() {
      el.hidden = false;
      onToggle(true);
      await reload();
      await summary();
      view.composer.focus();
    },
    close() {
      el.hidden = true;
      onToggle(false);
    },
    toggle() {
      return api.isOpen() ? api.close() : api.open();
    },
  };
  return api;
}

/** The Kaity center as a page of its own (/_tykerf/edit/_site/kaity, "Open as page"): the same thread, full width. */
let fullView = null;
export const kaityScreen = {
  title: () => t('Kaity center'),
  async render(main) {
    const q = new URLSearchParams(location.search);
    main.innerHTML = `<header class="khead page"><h1>${esc(t('Kaity center'))}</h1><p class="note">${esc(t('Everything Kaity was asked and did, on the whole site and on every page, oldest first: the newest is at the bottom, next to where you write.'))}</p></header>`;
    fullView = createThreadView({ full: true, page: null, filter: q.get('filter') ?? null });
    main.append(fullView.el);
    await fullView.reload();
    fullView.composer.focus();
  },
  onAi(m) {
    if (!fullView) return;
    if (m?.role === 'step') return fullView.step(m.page ?? '', m.text);
    void fullView.reload();
  },
};
