// The page's sections (v4 round 2): Tasks on this page, Kaity on this page, Blocks, fixing one thing by hand, and
// the Site. One accordion component, shown in the rail, or dropped from the top
// bar's "This page ▾" while the rail is folded: the same sections, from the same functions, in either place. Which
// sections are open is remembered in this browser (per page mode), across pages and reloads.
//
// A section: { key, title(), count(), summary() (beside a closed title), body() (HTML), el (a node kept as it is:
// the inspector, the fix panel; it moves to whichever accordion shows it), shown() (false: left out), open (the
// default) }. Clicks in the bodies are the caller's: it listens on the accordion's element.

import { CHEVRON, esc, store } from './common.js';

const KEY = 'sections';
const remembered = () => store.get(KEY, {});

/** Whether a section is open: as the person left it, else its default. */
export const isOpen = (s) => remembered()[s.key] ?? !!s.open;

/** Open or close a section, everywhere it is shown (the next render of each accordion). */
export function setOpen(key, open) {
  store.set(KEY, { ...remembered(), [key]: open });
}

/**
 * An accordion of `sections()` (the list may change: a block selected, a fix opened). `only`: the keys this one
 * shows (the drop-down shows the page's own sections, not the Site). `onToggle(key, open)`.
 */
export function createAccordion({ sections, only = null, onToggle = () => {}, label = '' }) {
  const el = document.createElement('div');
  el.className = 'acc';
  if (label) el.setAttribute('aria-label', label);

  // each section keeps its element: a body is drawn again only when its HTML changed (what is typed in it stays),
  // and a kept node (the inspector, being edited) is never taken out while its section is shown
  function render() {
    const list = sections().filter((s) => (s.shown?.() ?? true) && (!only || only.includes(s.key)));
    const want = new Set(list.map((s) => s.key));
    for (const sec of [...el.children]) if (!want.has(sec.dataset.section)) sec.remove();
    let prev = null;
    for (const s of list) {
      let sec = [...el.children].find((x) => x.dataset.section === s.key);
      if (!sec) {
        sec = document.createElement('section');
        sec.className = 'acc-s';
        sec.dataset.section = s.key;
        sec.innerHTML = `<h2></h2><div class="acc-b" id="acc-${esc(s.key)}-${only ? 'm' : 'r'}"></div>`;
      }
      if (prev ? prev.nextElementSibling !== sec : el.firstElementChild !== sec) (prev ? prev.after(sec) : el.prepend(sec));
      prev = sec;
      const open = isOpen(s);
      const count = s.count?.();
      const sum = !open && s.summary ? s.summary() : '';
      const head = `<button type="button" class="acc-h" data-acc="${esc(s.key)}" aria-expanded="${open}" aria-controls="acc-${esc(s.key)}-${only ? 'm' : 'r'}">${CHEVRON}<span class="acc-t">${esc(s.title())}</span>${sum ? `<span class="acc-sum">${esc(sum)}</span>` : ''}${count !== undefined && count !== null && count !== '' ? `<span class="acc-n">${esc(String(count))}</span>` : ''}</button>`;
      const h = sec.firstElementChild;
      if (h.dataset.html !== head) (h.innerHTML = head), (h.dataset.html = head);
      const b = sec.lastElementChild;
      b.hidden = !open;
      if (s.el) {
        if (s.el.parentNode !== b) b.replaceChildren(s.el);
      } else if (open) {
        const html = s.body();
        if (b.dataset.html !== html) (b.innerHTML = html), (b.dataset.html = html);
      }
    }
  }

  el.addEventListener('click', (e) => {
    const h = e.target.closest('[data-acc]');
    if (!h) return;
    const key = h.dataset.acc;
    const open = h.getAttribute('aria-expanded') !== 'true';
    setOpen(key, open);
    onToggle(key, open);
    render();
  });

  return {
    el,
    render,
    /** Open a section and bring it into view (the header's "This page", Details on a block). */
    show(key, { focus = false } = {}) {
      setOpen(key, true);
      render();
      const s = el.querySelector(`[data-section="${CSS.escape(key)}"]`);
      s?.scrollIntoView({ block: 'nearest' });
      if (focus) s?.querySelector('.acc-h')?.focus();
    },
  };
}
