// The page in its frame (v3 editor): the only code that touches the page's document. The page is served as it is
// (`?tykerf=frame`: no editor script in it) from the same origin, so the shell reaches into it directly: it turns
// the page into something to point at (a click picks an element; links, buttons and forms don't react), finds the
// block and the element path of what is picked, measures elements for what the shell draws over the frame, and
// swaps in new content in place after a change. Nothing is drawn inside the page.

import { atPath, elementPath } from '../inline.js';

/** The words in an element, a space between the texts of its parts (a badge and its label don't run together). */
function wordsIn(el) {
  const out = [];
  const walk = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('script, style, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = walk.nextNode(); n && out.join(' ').length < 80; n = walk.nextNode()) if (n.textContent.trim()) out.push(n.textContent.trim());
  return out.join(' ');
}

/** An element in a few words, as the person sees it (tasks keep this as their label): tag, then first words. */
export function describeEl(el) {
  const tag = el.nodeName.toLowerCase();
  const words = (el.nodeName === 'IMG' ? el.alt : wordsIn(el)).replace(/\s+/g, ' ').trim();
  return words ? `${tag} "${words.length > 40 ? `${words.slice(0, 39)}…` : words}"` : tag;
}

const BLOCK_EVENTS = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit', 'contextmenu'];

/**
 * Show the page `src` in `iframe`. `on` gets: `hover(spot|null)`, `pick(spot, x, y)` (a click; x, y in the frame's
 * viewport), `moved()` (scroll, resize or new content: redraw), `key(event)` (a key pressed in the page),
 * `loaded()` (a new document), `scrolled()` (the person scrolled the page themselves), `leads(href)` (while trying
 * the page, a link to somewhere else was clicked: it doesn't go). `isBlock(id)` says which `[data-sw]` ids are blocks.
 */
export function createFrame(iframe, { isBlock, on, passive = () => false }) {
  let win = null, doc = null, observer = null;
  let trying = false; // the page reacts as for a visitor (Try the button), except links that would leave it

  const blockAt = (el) => {
    for (let x = el?.closest?.('[data-sw]'); x; x = x.parentElement?.closest('[data-sw]')) if (isBlock(x.dataset.sw)) return x.dataset.sw;
    return null;
  };
  const blockEl = (id) => doc?.querySelector(`[data-sw="${CSS.escape(id)}"]`) ?? null;

  /** Where a task on this element goes: its block and its place inside it (the block itself when it isn't counted). */
  function spotAt(el) {
    const block = blockAt(el);
    if (!block) return null;
    const root = blockEl(block);
    // an element the code doesn't count (inside a <script> or <template>, say) takes the nearest one it does
    for (let x = el; x && x !== root; x = x.parentElement) {
      const path = elementPath(x, root);
      if (path) return { block, path, el: x, label: describeEl(x) };
    }
    return { block, path: null, el: root, label: '' };
  }

  function attach() {
    win = iframe.contentWindow;
    doc = iframe.contentDocument;
    if (!doc) return;
    // the full editor in the frame (the shell's Full editor mode) points at the page itself: the shell only follows it
    if (passive()) {
      doc.addEventListener('keydown', (e) => e.altKey && e.shiftKey && e.code === 'KeyT' && on.key(e), true);
      win.addEventListener('scroll', () => on.moved(), { passive: true });
      return on.loaded();
    }
    doc.documentElement.style.cursor = trying ? '' : 'crosshair';
    doc.addEventListener('pointermove', (e) => on.hover(trying ? null : spotAt(e.target)), true);
    for (const type of ['wheel', 'touchmove']) doc.addEventListener(type, () => on.scrolled(), { passive: true, capture: true });
    doc.documentElement.addEventListener('mouseleave', () => on.hover(null));
    // the page is for pointing: nothing on it reacts, a left click picks what it lands on
    for (const type of BLOCK_EVENTS) {
      doc.addEventListener(type, (e) => {
        if (trying) {
          // a link within the page (#section) works; one to another page or site says where it leads instead
          const a = type === 'click' ? e.target.closest?.('a[href]') : null;
          const href = a?.getAttribute('href') ?? '';
          if (a && !href.startsWith('#')) (e.preventDefault(), on.leads(a.href));
          if (type === 'submit') e.preventDefault();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === 'click' && e.button === 0) {
          const spot = spotAt(e.target);
          if (spot) on.pick(spot, e.clientX, e.clientY);
        }
        // the second button: what can be done here (the shell's menu)
        if (type === 'contextmenu') {
          const spot = spotAt(e.target);
          if (spot) on.menu?.(spot, e.clientX, e.clientY);
        }
      }, true);
    }
    doc.addEventListener('keydown', (e) => on.key(e), true);
    win.addEventListener('scroll', () => on.moved(), { passive: true });
    win.addEventListener('resize', () => on.moved());
    observer?.disconnect();
    observer = new win.ResizeObserver(() => on.moved());
    observer.observe(doc.documentElement);
    // the site's behaviours that failed show in the frame's console; the page keeps working
    on.loaded();
  }
  iframe.addEventListener('load', attach);

  return {
    /** Load (or reload) the page; `keepScroll` comes back to where it was. */
    load(src, { keepScroll = false } = {}) {
      const y = keepScroll && win ? win.scrollY : 0;
      if (keepScroll) iframe.addEventListener('load', () => iframe.contentWindow.scrollTo(0, y), { once: true });
      if (iframe.getAttribute('src') === src && win) win.location.reload();
      else iframe.src = src;
    },
    /** New content in place (after a change): the page's style and body, scripts run again, the scroll stays. */
    swap({ css, body, lang }) {
      if (!doc) return;
      const style = doc.getElementById('sw--style');
      const page = doc.getElementById('sw--page');
      if (!style || !page) return win.location.reload();
      style.textContent = css;
      if (lang) doc.documentElement.lang = lang;
      page.innerHTML = body;
      for (const old of page.querySelectorAll('script')) {
        const s = doc.createElement('script');
        for (const a of old.attributes) s.setAttribute(a.name, a.value);
        s.textContent = old.textContent;
        old.replaceWith(s);
      }
      doc.dispatchEvent(new Event('tykerf:render')); // the site's behaviours (kit/scripts) run on the new elements
      on.moved();
    },
    /** Let the page react as for a visitor (true), or back to pointing at it (false). */
    try(v) {
      trying = v;
      if (doc) doc.documentElement.style.cursor = v ? '' : 'crosshair';
    },
    get width() {
      return win?.innerWidth ?? iframe.clientWidth;
    },
    blockEl,
    /** The element a task is on now: its block, then the element at its path (the block when that is gone). */
    taskEl(block, path) {
      const root = blockEl(block);
      if (!root || !path?.length) return root;
      return atPath(root, path) ?? root;
    },
    /** An element's box in the frame's viewport (where the overlay draws), or null when it isn't shown. */
    rect(el) {
      if (!el?.isConnected) return null;
      const r = el.getBoundingClientRect();
      return r.width || r.height ? r : null;
    },
    /** Bring an element into sight, below what covers the top of the frame (`top` px). */
    show(el, top = 0) {
      if (!el?.isConnected || !win) return;
      const r = el.getBoundingClientRect();
      const still = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const room = win.innerHeight - top;
      win.scrollTo({ top: win.scrollY + r.top - top - Math.max(16, (room - r.height) / 2), behavior: still ? 'auto' : 'smooth' });
    },
  };
}
