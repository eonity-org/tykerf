// The site in the v4 editor (/_tykerf/edit/_site/<screen>): the one frame (chrome.js: the top bar and the rail)
// around the site's screens. The Overview is where the editor opens; the others are the site's screens
// (screens.js), New page (newpage.js) and the Kaity center as a page (kaity.js). Under every screen, the Kaity line
// (kaityline.js), on the whole site.

import { $, failed, request, t, toast, watchVersion } from './common.js';
import { SCREEN_TITLES, checkState, createRail, renderTop } from './chrome.js';
import { createKaityCenter, kaityScreen, onKaityNews } from './kaity.js';
import { createKaityLine } from './kaityline.js';
import { newScreen } from './newpage.js';
import { overviewScreen } from './overview.js';
import { SCREENS as OTHERS } from './screens.js';

export const SCREENS = { overview: overviewScreen, ...OTHERS, kaity: kaityScreen, new: newScreen };

export async function siteMode() {
  const from = new URLSearchParams(location.search).get('from');
  const screenOf = () => location.pathname.match(/^\/_tykerf\/edit\/_site\/([a-z-]*)/)?.[1] || 'overview';
  let screen = SCREENS[screenOf()] ? screenOf() : 'overview';
  document.body.classList.add('site-mode');
  $('.stage').outerHTML = '<div class="work"><div class="sitecol"><main class="screen" tabindex="-1"></main></div></div>';
  const main = $('.screen');
  const bar = $('.bar');
  let history = null, pending = null, crumb = null;

  const rail = createRail({ screen: () => screen, go, pending: () => pending, onKaity: () => center.toggle() });
  $('.work').prepend(rail.el);
  const center = createKaityCenter({ onToggle: () => renderBar() });
  // the Kaity line: on the site's screens, the whole site
  const line = createKaityLine({ sent: () => (toast(t('Kaity is on it: she works on the whole site')), center.open()) });
  $('.sitecol').append(line.el);

  function renderBar() {
    const info = rail.info;
    renderTop(bar, {
      crumb: crumb ?? SCREEN_TITLES[screen]?.() ?? '',
      undo: history?.undo ?? null,
      kaity: { count: info?.thread?.items?.length ?? 0, waiting: info?.thread?.waiting ?? 0, working: !!info?.thread?.running, open: center.isOpen() },
      checks: info ? checkState(info.check) : null,
      publishFrom: from,
    });
  }

  bar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-top]')?.dataset.top;
    if (act === 'kaity') return center.toggle();
    if (act === 'checks') return e.preventDefault(), go('check');
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
    openKaity: () => center.open(),
    setTitle: (s) => ((crumb = s), renderBar()),
    setPending: (name) => {
      if (pending === name) return;
      pending = name;
      rail.render();
    },
  };

  async function show() {
    crumb = null;
    if (screen !== 'new') pending = null;
    document.title = `${SCREEN_TITLES[screen]?.() ?? ''} · tykerf`;
    renderBar();
    rail.render();
    main.onclick = main.onsubmit = main.oninput = main.onchange = main.onkeydown = main.ondragover = main.ondrop = main.onpaste = null;
    await SCREENS[screen].render(main, ctx);
  }

  async function reload() {
    await Promise.all([rail.refresh().then(renderBar), loadHistory(), SCREENS[screen].render(main, ctx)]);
  }

  function go(next) {
    if (!SCREENS[next]) return;
    screen = next;
    window.history.pushState(null, '', `/_tykerf/edit/_site/${next === 'overview' ? '' : next}${from ? `?from=${encodeURIComponent(from)}` : ''}`);
    void show().then(() => main.focus());
  }
  addEventListener('popstate', () => {
    screen = SCREENS[screenOf()] ? screenOf() : 'overview';
    void show();
  });
  addEventListener('resize', () => SCREENS[screen].resize?.());

  // the site's live news: Kaity's runs on its pages and on the whole site
  let soon = 0;
  const later = () => (clearTimeout(soon), (soon = setTimeout(() => void Promise.all([rail.refresh().then(renderBar), screen === 'overview' || screen === 'tasks' ? SCREENS[screen].render(main, ctx) : null]), 300)));
  onKaityNews((kind, m) => {
    SCREENS[screen].onAi?.(m, main, ctx);
    if (kind === 'taskrun' || (kind === 'ai' && ['start', 'end', 'undone'].includes(m?.role))) later();
  });
  // pages made or changed elsewhere (Kaity on the site, another tab, the command line) show when the person comes back
  addEventListener('focus', () => rail.refresh().then(renderBar).catch(() => {}));

  renderBar();
  watchVersion();
  await Promise.all([rail.refresh().then(renderBar), loadHistory(), show()]);
}
