// The site in the v3 editor: the sidebar (R7) and the site's own screens (R11, R12, R14).
//
// On a page, the page switcher opens the sidebar from the left, over the page (the page doesn't move or resize).
// It stays until the person closes it, from one page to the next (open, folded to its edge, or closed: remembered).
// It holds Ask Kaity about the whole site, the pages as large cards with their actions in words, and the whole
// site's screens, each with its state on the right. On the site's screens (/_tykerf/edit/_site/<screen>) there is
// no page behind it, so it is docked on the left, beside the screen (screens.js).

import { $, CHEVRON, MARK, esc, failed, hardToReach, kaityMark, keptTwice, request, store, t, toast, watchVersion } from './common.js';
import { SCREENS } from './screens.js';

/** Everything the sidebar says about the site, from the site's endpoints (each may fail on its own). */
export async function siteInfo() {
  const get = (u) => request(u).catch(() => null);
  const [site, tasks, check, kit, media, links, kaity] = await Promise.all([
    get('/_tykerf/site'), get('/_tykerf/site/tasks'), get('/_tykerf/site/check'), get('/_tykerf/site/kit'),
    get('/_tykerf/site/media'), get('/_tykerf/site/links'), get('/_tykerf/site/kaity'),
  ]);
  return { site, tasks, check, kit, media, links, kaity };
}

/** The whole site's screens, each with its state now, for the sidebar's list. */
function screenStates(info) {
  const { site, tasks, check, kit, media, links, kaity } = info;
  const total = tasks?.total ?? 0, onPages = tasks?.pages?.filter((x) => x.tasks.length).length ?? 0;
  const blocks = kit?.files?.blocks?.length ?? 0, could = kit?.identical?.length ?? 0;
  const findings = check?.findings?.length ?? 0;
  const files = media?.files ?? [], twice = keptTwice(files).length;
  const linkCount = links?.links?.filter((l) => !l.broken).length ?? 0, hard = hardToReach(site?.pages, links?.links, site?.home).length;
  const runs = kaity?.runs ?? [], working = runs.some((r) => r.state === 'working');
  return {
    tasks: total ? (onPages === 1 ? t('{n} open on 1 page', { n: total }) : t('{n} open on {m} pages', { n: total, m: onPages })) : t('none open'),
    shared: could ? t('{n} · {m} more could be', { n: blocks, m: could }) : String(blocks),
    check: findings,
    media: twice ? t('{n} files · {m} kept twice', { n: files.length, m: twice }) : t('{n} files', { n: files.length }),
    links: linkCount ? (hard ? t('{n} · {m} hard to reach', { n: linkCount, m: hard }) : String(linkCount)) : t('none yet'),
    kaity: working ? t('working now') : runs.length === 1 ? t('1 request') : runs.length ? t('{n} requests', { n: runs.length }) : t('nothing yet'),
    settings: site?.langSet ? t('language: {lang}', { lang: site.lang }) : t('language not set'),
  };
}

const SCREEN_ORDER = ['tasks', 'shared', 'check', 'media', 'links', 'kaity', 'settings'];

/**
 * The sidebar. `page`: the page open behind it (null on a site screen). `docked`: beside a site screen (else over
 * the page). `go(screen)`: open a site screen. `screen`: the one shown now (site mode).
 */
export function createSidebar({ page = null, docked = false, go, screen = () => null, onChange = () => {}, modeSwitch = null, setMode = null, pageHref = (p) => `/_tykerf/edit/${encodeURIComponent(p)}/` }) {
  const el = document.createElement('aside');
  el.className = `sidebar${docked ? ' docked' : ''}`;
  el.setAttribute('aria-label', t('The site'));
  el.hidden = !docked;
  (docked ? $('.layout') : $('.stage')).prepend(el);
  let info = null, acting = null; // acting: { page, what } for a page's open form or confirmation
  let folded = false; // over a page: only its edge shows, with a way to open it again
  let suspended = false; // out of the way while the fix panel is open, as it was before that
  /** Open, folded or closed: what a page opens with next (a site screen's docked sidebar is always open). */
  const remember = (state) => !docked && store.set('sidebar', state);

  async function refresh() {
    info = await siteInfo();
    render();
  }

  /** What removing a page breaks: the links to it from the other pages. */
  function linksTo(p) {
    const mine = (acting?.links ?? []).filter((l) => l.to === p && l.page !== p);
    const from = [...new Set(mine.map((l) => l.page))].join(', ');
    return mine.length === 1 ? t('One link to it from {pages} will point nowhere.', { pages: from })
      : mine.length ? t('{n} links to it from {pages} will point nowhere.', { n: mine.length, pages: from }) : t('No other page links to it.');
  }

  function pageCard(p) {
    const s = info.site;
    const nTasks = info.tasks?.pages?.find((x) => x.page === p)?.tasks.length ?? 0;
    const nCheck = info.check?.findings?.filter((f) => f.page === p).length ?? 0;
    const state = [
      p === page ? t('Open now') : '',
      nTasks ? (nTasks === 1 ? t('1 task') : t('{n} tasks', { n: nTasks })) : '',
      nCheck ? (nCheck === 1 ? t('1 thing to check') : t('{n} things to check', { n: nCheck })) : '',
    ].filter(Boolean).join(' · ');
    const home = s.home === p;
    const form = acting?.page === p && acting.what === 'name' ? `
      <form class="pform" data-page="${esc(p)}">
        <label>${esc(t('Name (its address)'))}<input name="to" value="${esc(p)}" pattern="[a-z0-9][a-z0-9-]*" required></label>
        <label>${esc(t('Title (in the browser tab and search results)'))}<input name="title" value="${esc(s.ownTitles?.[p] ?? '')}" placeholder="${esc(s.titles?.[p] ?? '')}"></label>
        <div class="row"><button class="btn primary small" type="submit">${esc(t('Save'))}</button><button class="btn small" type="button" data-pact="cancel">${esc(t('Cancel'))}</button></div>
      </form>` : acting?.page === p && acting.what === 'remove' ? `
      <div class="confirm" role="alert"><p>${esc(t('Remove {page}? It goes to the site\'s trash, and links to it stop working.', { page: p }))}</p>
        <p class="hint">${esc(linksTo(p))}</p>
        <div class="row"><button class="btn small danger" type="button" data-pact="remove-yes">${esc(t('Remove {page}', { page: p }))}</button><button class="btn small" type="button" data-pact="cancel">${esc(t('Cancel'))}</button></div></div>` : '';
    return `<li class="pcard${p === page ? ' current' : ''}" data-page="${esc(p)}">
      <a class="popen" href="${pageHref(p)}" ${p === page ? 'aria-current="page"' : ''}>
        <span class="pname">${esc(p)}</span><span class="paddr">/${esc(p)}/</span>${home ? `<span class="hometag">${esc(t('Home'))}</span>` : ''}
        ${state ? `<span class="pstate">${esc(state)}</span>` : ''}
      </a>
      <div class="pacts">
        ${home ? '' : `<button type="button" class="btn small" data-pact="home">${esc(t('Make it home'))}</button>`}
        <button type="button" class="btn small" data-pact="name">${esc(t('Name and title'))}</button>
        <button type="button" class="btn small" data-pact="duplicate">${esc(t('Duplicate'))}</button>
        <button type="button" class="btn small danger" data-pact="remove">${esc(t('Remove'))}</button>
      </div>${form}
    </li>`;
  }

  function render() {
    if (folded) {
      el.innerHTML = `<button type="button" class="sbunfold" data-sb="unfold" aria-label="${esc(t('Open the site sidebar'))}" title="${esc(t('Open the site sidebar'))}">›</button>`;
      return;
    }
    if (!info?.site) return void (el.innerHTML = `<p class="loading">${esc(t('Loading the site…'))}</p>`);
    const s = info.site, states = screenStates(info);
    const now = screen();
    el.innerHTML = `
      <div class="sbtop">${!docked && modeSwitch ? modeSwitch() : ''}${docked ? '' : `<button type="button" class="btn small" data-sb="fold" aria-label="${esc(t('Fold the sidebar to its edge'))}" title="${esc(t('Fold the sidebar to its edge'))}">‹</button>`}<button type="button" class="btn small" data-sb="collapse">${esc(docked ? t('Collapse') : t('Close'))}</button></div>
      <form class="askk">
        ${kaityMark(false, true)}
        <label for="ask-site">${esc(t('Ask Kaity about the whole site'))}</label>
        <input id="ask-site" name="prompt" placeholder="${esc(t('e.g. Link the navigation to all the pages'))}" autocomplete="off">
        <button class="btn primary" type="submit">${esc(t('Ask'))}</button>
      </form>
      <div class="levelhead"><h2>${esc(t('Level 0 · The top of the site'))}</h2><a class="btn small" href="/_tykerf/edit/_site/new${page ? `?from=${encodeURIComponent(page)}` : ''}" data-screen="new">${esc(t('+ Page'))}</a></div>
      <ul class="pages">${s.pages.map(pageCard).join('')}</ul>
      <h2 class="wholehead">${esc(t('The whole site'))}</h2>
      <ul class="screens">${SCREEN_ORDER.map((k) => `<li><a href="/_tykerf/edit/_site/${k}${page ? `?from=${encodeURIComponent(page)}` : ''}" data-screen="${k}" ${now === k ? 'aria-current="page"' : ''}>
        <span>${esc(SCREENS[k].title())}</span>${k === 'check' ? (states.check ? `<span class="badge">${states.check}</span>` : `<span class="sstate">${esc(t('all good'))}</span>`) : `<span class="sstate">${esc(states[k])}</span>`}</a></li>`).join('')}</ul>
      <div class="sbfoot">
        <a class="btn main" href="/_tykerf/edit/_site/publish${page ? `?from=${encodeURIComponent(page)}` : ''}" data-screen="publish">${esc(t('Publish'))}</a>
        <a class="btn" href="/_tykerf/edit/_site/history${page ? `?from=${encodeURIComponent(page)}` : ''}" data-screen="history">${esc(t('Site history'))}</a>
        ${s.signin ? `<button type="button" class="btn" data-sb="signout">${esc(t('Sign out'))}</button>` : ''}
      </div>`;
  }

  el.addEventListener('click', async (e) => {
    const sc = e.target.closest('[data-screen]');
    if (sc && go) return e.preventDefault(), go(sc.dataset.screen);
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode && setMode) return setMode(mode);
    const sb = e.target.closest('[data-sb]')?.dataset.sb;
    if (sb === 'collapse') return api.close();
    if (sb === 'fold') return api.fold();
    if (sb === 'unfold') return api.open();
    if (sb === 'signout') {
      await request('/_tykerf/logout', {}).catch(() => {});
      try { localStorage.removeItem('tykerf.admin'); } catch {}
      return location.assign('/');
    }
    const b = e.target.closest('[data-pact]');
    if (!b) return;
    const p = b.closest('[data-page]').dataset.page;
    const what = b.dataset.pact;
    try {
      if (what === 'cancel') acting = null;
      else if (what === 'name') acting = { page: p, what };
      else if (what === 'remove') acting = { page: p, what, links: (await request('/_tykerf/site/links').catch(() => ({ links: [] }))).links };
      else if (what === 'home') (await request('/_tykerf/site/home', { name: p }), toast(t('{page} is the home page now', { page: p })));
      else if (what === 'duplicate') {
        const r = await request('/_tykerf/site/duplicate', { name: p });
        toast(t('{page} is a copy of {from}', { page: r.name, from: p }));
      } else if (what === 'remove-yes') {
        await request('/_tykerf/site/remove', { name: p });
        acting = null;
        toast(t('{page} is in the site\'s trash', { page: p }));
        if (p === page) return location.assign('/_tykerf/edit/_site/tasks');
      }
      await refresh();
      onChange();
    } catch (err) {
      failed(err);
    }
  });

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('askk')) {
      const prompt = f.elements.prompt.value.trim();
      if (!prompt) return f.elements.prompt.focus();
      try {
        await request('/_tykerf/site/ask', { prompt });
        return go ? go('kaity') : location.assign(`/_tykerf/edit/_site/kaity${page ? `?from=${encodeURIComponent(page)}` : ''}`);
      } catch (err) {
        return failed(err);
      }
    }
    if (f.classList.contains('pform')) {
      const p = f.dataset.page, to = f.elements.to.value.trim(), title = f.elements.title.value.trim();
      try {
        const s = info.site;
        if (title !== (s.ownTitles?.[p] ?? '')) await request('/_tykerf/site/title', { name: p, title });
        if (to !== p) {
          await request('/_tykerf/site/rename', { name: p, to });
          if (p === page) return location.assign(`/_tykerf/edit/${encodeURIComponent(to)}/`);
        }
        acting = null;
        await refresh();
        onChange();
      } catch (err) {
        failed(err);
      }
    }
  });

  // pages made or changed elsewhere (Kaity on the site, another tab, the command line) show when the person comes back
  addEventListener('focus', () => !el.hidden && refresh().catch(() => {}));

  const show = (fold) => {
    folded = fold;
    suspended = false;
    el.hidden = false;
    el.classList.toggle('folded', fold);
    document.body.classList.toggle('sidebar-open', !fold);
  };
  const api = {
    el,
    /** Open in full (folded or closed: not). */
    isOpen: () => !el.hidden && !folded,
    /** On the screen at all, open or folded: what the page beside it makes room for. */
    isShown: () => !el.hidden,
    async open() {
      show(false);
      remember('open');
      onChange();
      if (!info) render();
      await refresh();
      $('a.popen, button', el)?.focus();
    },
    /** Only its edge, with › to open it again. */
    fold() {
      show(true);
      remember('folded');
      render();
      onChange();
    },
    close() {
      el.hidden = true;
      folded = suspended = false;
      el.classList.remove('folded');
      document.body.classList.remove('sidebar-open');
      remember('closed');
      onChange();
    },
    toggle() {
      return api.isOpen() ? api.close() : api.open();
    },
    /** As the person left it, on the last page (a page opens with it). */
    restore() {
      const state = docked ? 'open' : store.get('sidebar', 'closed');
      if (state === 'open') return api.open();
      if (state === 'folded') return api.fold();
    },
    /** Out of the way for a while (the fix panel takes the left), and back as it was. */
    suspend() {
      if (el.hidden) return;
      el.hidden = true;
      suspended = true;
      onChange();
    },
    resume() {
      if (!suspended) return;
      suspended = false;
      el.hidden = false;
      onChange();
    },
    refresh,
    render,
  };
  return api;
}

// ---------- the whole site: the sidebar docked, a screen beside it ----------

export async function siteMode() {
  const from = new URLSearchParams(location.search).get('from');
  const screenOf = () => location.pathname.match(/^\/_tykerf\/edit\/_site\/([a-z-]*)/)?.[1] || 'tasks';
  let screen = SCREENS[screenOf()] ? screenOf() : 'tasks';
  document.body.classList.add('site-mode');
  // the stage becomes the docked sidebar and the screen
  const stage = $('.stage');
  stage.outerHTML = '<div class="layout"><main class="screen" tabindex="-1"></main></div>';
  const main = $('.screen');
  let history = null;

  const sidebar = createSidebar({ docked: true, go, screen: () => screen, onChange: () => renderBar() });
  const bar = $('.bar');

  function renderBar() {
    const undo = history?.undo;
    if (SCREENS[screen].full) {
      // a screen of its own (New page): the way back, nothing else
      bar.innerHTML = `<span class="switcher static">${MARK}<span class="name">${esc(SCREENS[screen].title())}</span></span>
        <div class="actions"><a class="btn" href="${from ? `/_tykerf/edit/${encodeURIComponent(from)}/` : '/_tykerf/edit/_site/tasks'}">${esc(from ? t('Cancel and go back to {page}', { page: from }) : t('Cancel and go back to the site'))}</a></div>`;
      return;
    }
    bar.innerHTML = `
      <button type="button" class="switcher" data-bar="site" aria-expanded="${sidebar.isOpen()}" aria-label="${esc(t('The site\'s pages and screens'))}">${MARK}<span class="name">${esc(t('Your site'))}</span>${CHEVRON}</button>
      <p class="hint"><b>${esc(SCREENS[screen].title())}</b></p>
      <div class="actions">
        ${from ? `<a class="btn" href="/_tykerf/edit/${encodeURIComponent(from)}/">${esc(t('Back to {page}', { page: from }))}</a>` : ''}
        <button type="button" class="btn" data-bar="undo" ${undo ? '' : 'disabled'} title="${esc(undo ? t('Undo "{step}"', { step: undo.label }) : t('Nothing to undo'))}" aria-label="${esc(undo ? t('Undo "{step}"', { step: undo.label }) : t('Nothing to undo'))}">${esc(t('Undo'))}</button>
        ${screen === 'publish' ? '' : `<a class="btn main" href="/_tykerf/edit/_site/publish${from ? `?from=${encodeURIComponent(from)}` : ''}" data-bar="publish">${esc(t('Publish'))}</a>`}
      </div>`;
  }

  bar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-bar]')?.dataset.bar;
    if (act === 'site') return sidebar.toggle();
    if (act === 'publish') return e.preventDefault(), go('publish');
    if (act === 'undo') {
      try {
        const r = await request('/_tykerf/site/undo', {});
        toast(t('Undone: {step}', { step: r.result ?? '' }));
        await reload();
      } catch (err) {
        failed(err);
      }
    }
  });

  async function loadHistory() {
    history = await request('/_tykerf/site/history').catch(() => null);
    renderBar();
  }

  const ctx = {
    go,
    from,
    refresh: () => reload(),
    sidebar,
  };

  async function show() {
    document.title = `${SCREENS[screen].title()} · tykerf`;
    const full = !!SCREENS[screen].full;
    document.body.classList.toggle('full-screen', full);
    if (full) sidebar.el.hidden = true;
    else if (sidebar.el.hidden && !matchMedia('(max-width: 900px)').matches) await sidebar.open();
    renderBar();
    sidebar.render();
    await SCREENS[screen].render(main, ctx);
  }

  async function reload() {
    await Promise.all([sidebar.refresh(), loadHistory(), SCREENS[screen].render(main, ctx)]);
  }

  function go(next) {
    if (!SCREENS[next]) return;
    screen = next;
    history_push(`/_tykerf/edit/_site/${next}${from ? `?from=${encodeURIComponent(from)}` : ''}`);
    if (matchMedia('(max-width: 900px)').matches) sidebar.close();
    void show().then(() => main.focus());
  }
  const history_push = (url) => window.history.pushState(null, '', url);
  addEventListener('popstate', () => {
    screen = SCREENS[screenOf()] ? screenOf() : 'tasks';
    void show();
  });

  // the site's live news: Kaity's runs on its pages, and her conversation about the whole site
  const events = new EventSource('/_tykerf/site/events');
  let soon = 0;
  const later = () => (clearTimeout(soon), (soon = setTimeout(() => void reload(), 250)));
  events.addEventListener('taskrun', () => (screen === 'tasks' ? later() : sidebar.refresh()));
  events.addEventListener('ai', (e) => {
    const m = JSON.parse(e.data);
    SCREENS[screen].onAi?.(m, main, ctx);
    if (m.role === 'end') later();
  });

  watchVersion();
  if (!SCREENS[screen].full && !matchMedia('(max-width: 900px)').matches) await sidebar.open();
  else sidebar.render();
  await Promise.all([show(), loadHistory()]);
}
