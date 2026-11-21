// The Kaity line (v4): the one place to ask Kaity something new, at the bottom of every screen: the site's screens, and
// a page in Tasks and in Edit (View, for now, has none). Where it is says what she may change: on the site's screens
// the whole site; on a page, This page or Whole site. One box of a page is asked in the task box on it (Ask Kaity
// now), never from here. It takes a request only while Kaity is free: while she works on anything, it says on what,
// keeps what is typed, and Ask waits. Replies to one of her runs (an answer, Keep, Widen, the shared block's OK) are
// on that run, in the thread.

import { createComposer } from './composer.js';
import { askKaity, onKaityNews } from './kaity.js';
import { request, t } from './common.js';

/** What Kaity is busy with, in words, or null when she is free (`/_tykerf/site/kaity/now`). */
export function busyWords(k, here = null) {
  if (!k) return null;
  if (k.site) return t('Kaity is working on the whole site');
  const p = k.pages?.find((x) => x.page === here) ?? k.pages?.[0];
  if (p) return t('Kaity is working on {page}', { page: p.page });
  if (k.queue?.length) return t('Kaity is working through the tasks');
  return null;
}

/**
 * The line. `page`: the page it is on (null on the site's screens); `sent(m, r)`: after a request went (`m.scope`,
 * the server's answer); `busy()`: a reason of the caller's to wait (a page's task run), or null.
 */
export function createKaityLine({ page = null, sent = () => {}, busy = () => null } = {}) {
  let kaity = null;
  const composer = createComposer({
    label: page ? t('Ask Kaity about this page') : t('Ask Kaity about the whole site'),
    line: true,
    scopes: page ? [{ key: 'page', label: t('This page') }, { key: 'site', label: t('Whole site') }] : [{ key: 'site', label: t('Whole site') }],
    scope: page ? 'page' : 'site',
    placeholder: (s) => (s === 'site' ? t('Ask Kaity about the whole site…') : t('Ask Kaity about {page}…', { page })),
    submit: () => t('Ask'),
    send: async (m) => {
      const why = busy() ?? busyWords(kaity, page);
      if (why) throw new Error(why);
      const r = await askKaity(m, { page });
      // she is busy from now: the line says so before her first step comes
      kaity = m.scope === 'site' || !page ? { site: true, pages: [] } : { site: false, pages: [{ page, block: r.id }] };
      update();
      sent(m, r);
    },
  });
  composer.el.classList.add('kline');
  // how much of the window's bottom it takes: what floats over the screen (the Kaity center, the full editor) stops above
  new ResizeObserver(() => {
    const r = composer.el.getBoundingClientRect();
    document.documentElement.style.setProperty('--kline-h', `${r.height ? Math.max(0, innerHeight - r.top) : 0}px`);
  }).observe(composer.el);
  const update = () => composer.setBlocked(busy() ?? busyWords(kaity, page));
  async function refresh() {
    try {
      kaity = await request('/_tykerf/site/kaity/now');
    } catch {}
    update();
  }
  let soon = 0;
  onKaityNews((kind, m) => {
    if (kind === 'taskrun' || (kind === 'ai' && ['start', 'end', 'undone'].includes(m?.role))) (clearTimeout(soon), (soon = setTimeout(refresh, 150)));
  });
  void refresh();
  return {
    el: composer.el,
    composer,
    /** Why Kaity can't take a request now, in words, or null. */
    why: () => busy() ?? busyWords(kaity, page),
    /** The caller's own reason changed (a task run started or ended). */
    update,
    refresh,
    focus: () => composer.focus(),
    set text(v) {
      composer.text = v;
    },
    /** This page, or the whole site. */
    aim(scope) {
      composer.setScopes(page ? [{ key: 'page', label: t('This page') }, { key: 'site', label: t('Whole site') }] : [{ key: 'site', label: t('Whole site') }], scope);
    },
  };
}
