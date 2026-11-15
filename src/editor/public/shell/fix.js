// Fixing one thing by hand in the v3 editor (R8), and the box tree (R9).
//
// Reached from "Fix it by hand" in the task box. It opens in a narrow sidebar and shows only the element that was
// clicked: a button's or link's words and where it leads, a heading's or paragraph's words, a picture's
// description. Saving maps the element back to its box's code by its path, and only when that code still has the
// element as the page shows it (as editing in place does); a part made by a script is fixed in the box's code.
// "More, if the fix is bigger" leads one step further: the box's size and look, all its text, its code, and the box
// tree, where boxes are moved, added, shared and deleted.

import { atPath, safeHref, sameElement, sameImage } from '../inline.js';
import { esc, failed, plainLabel, t, toast } from './common.js';

const TEXT_SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const parse = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
};

/** Every piece of text, picture and link target in a box's code, each with a way to change it. */
function textFields(tpl) {
  const fields = [];
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3 && c.nodeValue.trim()) {
        const tag = c.parentNode.nodeName === '#document-fragment' ? 'text' : c.parentNode.nodeName.toLowerCase();
        fields.push({ label: tag, value: c.nodeValue.trim(), set: (v) => { const m = c.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/); c.nodeValue = m[1] + v + m[2]; } });
      } else if (c.nodeType === 1 && !TEXT_SKIP.has(c.nodeName)) {
        if (c.nodeName === 'IMG') fields.push({ label: t('picture description'), value: c.getAttribute('alt') ?? '', set: (v) => c.setAttribute('alt', v) });
        walk(c);
        if (c.nodeName === 'A' && c.hasAttribute('href')) fields.push({ label: t('link to'), value: c.getAttribute('href'), link: true, set: (v) => c.setAttribute('href', v) });
      }
    }
  };
  walk(tpl.content);
  return fields;
}

/** The kind of fix an element takes. */
function kindOf(el) {
  if (!el) return 'box';
  if (el.nodeName === 'IMG') return 'picture';
  if (el.nodeName === 'A') return 'link';
  if (el.nodeName === 'BUTTON') return 'button';
  return el.children.length ? 'rich' : 'text';
}

/**
 * The panel. `ctx`: { api, frame, page, tree(), tasks(), siteKit(), onClose(), toTask(spot), onChange() }.
 * `open(spot)` shows an element (spot.path null: the whole box); `tree(block)` shows the box tree.
 */
export function createFixPanel(ctx) {
  const el = document.createElement('aside');
  el.className = 'fixbar';
  el.setAttribute('aria-label', t('Fixing by hand'));
  el.hidden = true;
  document.querySelector('.stage').prepend(el);
  /** What it shows: { view: 'element' | 'text' | 'code' | 'look' | 'tree', spot, box, tpl, code, same, selected, confirm } */
  let S = null;

  async function load(block) {
    const box = await ctx.api(`/box?id=${encodeURIComponent(block)}`);
    return { box, tpl: parse(box.html) };
  }

  const head = (title, sub) => `<div class="fxtop">${ctx.modeSwitch()}<button type="button" class="btn small" data-fx="close">${esc(t('Collapse'))}</button></div>
    <h2 class="fxtitle">${esc(title)}</h2>${sub ? `<p class="fxsub">${esc(sub)}</p>` : ''}`;

  /** The one line about other pages: a shared block reaches them, an identical box doesn't. */
  function reach(block, box) {
    if (box.shared) return t('{block} shows the shared block {name}: a fix here changes it on every page that shows it ({pages}).', { block, name: box.shared.name, pages: box.shared.pages.join(', ') });
    const twin = ctx.siteKit()?.identical?.find((x) => x.box === block && x.pages.includes(ctx.page));
    const others = twin?.pages.filter((p) => p !== ctx.page) ?? [];
    return others.length ? t('{block} is the same on {pages}. This fix stays on {page} unless you share the box.', { block, pages: others.join(', '), page: ctx.page }) : '';
  }

  /** Where a link may lead: nowhere yet, a block of this page, a page of the site, or another address. */
  function leadsTo(href) {
    const blocks = ctx.blocks().filter((b) => b !== ctx.tree()?.id);
    const pages = ctx.pages();
    const known = ['#', ...blocks.map((b) => `#sw-${b}`), ...pages.map((p) => `/${p}/`)];
    const other = href && !known.includes(href);
    return `<label class="fxlabel" for="fx-href">${esc(t('Where it leads'))}</label>
      <select id="fx-href" name="href">
        <option value="#" ${!href || href === '#' ? 'selected' : ''}>${esc(t('Nowhere yet'))}</option>
        <optgroup label="${esc(t('This page'))}">${blocks.map((b) => `<option value="#sw-${esc(b)}" ${href === `#sw-${b}` ? 'selected' : ''}>${esc(t('The {block} box', { block: b }))}</option>`).join('')}</optgroup>
        <optgroup label="${esc(t('A page of the site'))}">${pages.map((p) => `<option value="/${esc(p)}/" ${href === `/${p}/` ? 'selected' : ''}>${esc(p)}</option>`).join('')}</optgroup>
        <option value="other" ${other ? 'selected' : ''}>${esc(t('Another address…'))}</option>
      </select>
      <input name="other" ${other ? '' : 'hidden'} value="${esc(other ? href : '')}" placeholder="https://" aria-label="${esc(t('The address'))}">`;
  }

  function moreList(block, nFields) {
    return `<div class="fxmore"><h3>${esc(t('More, if the fix is bigger'))}</h3><ul>
      <li><button type="button" data-view="look"><span>${esc(t('{block}\'s size and look', { block }))}</span><span class="sstate">${esc(t('width, height, band'))}</span></button></li>
      <li><button type="button" data-view="text"><span>${esc(t('All the text in {block}', { block }))}</span><span class="sstate">${esc(nFields === 1 ? t('1 field') : t('{n} fields', { n: nFields }))}</span></button></li>
      <li><button type="button" data-view="code"><span>${esc(t('{block}\'s code', { block }))}</span><span class="sstate">${esc(t('markup and style'))}</span></button></li>
      <li><button type="button" data-view="tree"><span>${esc(t('Move, add or delete boxes'))}</span><span class="sstate">${esc(t('the box tree'))}</span></button></li>
    </ul></div>`;
  }

  const foot = () => `<p class="fxfoot"><button type="button" class="link" data-fx="task">${esc(t('Too much to fix by hand? Leave it as a task for Kaity'))}</button></p>`;
  const back = () => `<button type="button" class="link back" data-view="element">${esc(t('← Back to {what}', { what: S.spot.path ? plainLabel(S.spot.label) : S.spot.block }))}</button>`;

  function renderElement() {
    const { spot, box, code, same } = S;
    const kind = same ? kindOf(code) : 'script';
    const title = spot.path ? plainLabel(spot.label) : t('The {block} box', { block: spot.block });
    let fields = '';
    if (kind === 'picture') fields = `<label class="fxlabel" for="fx-alt">${esc(t('What it shows (for people who can\'t see it)'))}</label><textarea id="fx-alt" name="alt" rows="2">${esc(code.getAttribute('alt') ?? '')}</textarea>
      <label class="btn small fxfile">${esc(t('Choose another picture…'))}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" name="picture" hidden></label>`;
    else if (kind === 'link' || kind === 'button' || kind === 'text') fields = code.children.length ? '' : `<label class="fxlabel" for="fx-text">${esc(t('Its text'))}</label><input id="fx-text" name="text" value="${esc(code.textContent.trim())}">`;
    if (kind === 'link') fields += leadsTo(code.getAttribute('href') ?? '');
    if (kind === 'text' && code.textContent.length > 60) fields = fields.replace(/<input id="fx-text" name="text" value="([^"]*)">/, '<textarea id="fx-text" name="text" rows="4">$1</textarea>');
    const nFields = textFields(S.tpl).length;
    const note = kind === 'script' ? t('This part is made by a script on the page, so it can\'t be fixed here: fix it in the box\'s code, below.')
      : kind === 'rich' ? t('This part holds other parts. Fix them one by one on the page, or all its text below.')
      : kind === 'box' ? '' : '';
    el.innerHTML = `${head(title, t('In {block}, on {page}', { block: spot.block, page: ctx.page }))}
      ${note ? `<p class="fxnote">${esc(note)}</p>` : ''}
      ${fields ? `<form class="fxform">${fields}<div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button><button class="btn" type="button" data-fx="revert">${esc(t('Revert'))}</button></div></form>` : kind === 'box' ? textForm() : ''}
      ${reach(spot.block, box) ? `<p class="fxnote">${esc(reach(spot.block, box))}</p>` : ''}
      ${moreList(spot.block, nFields)}${foot()}`;
    const other = el.querySelector('[name=other]');
    el.querySelector('[name=href]')?.addEventListener('change', (e) => {
      other.hidden = e.target.value !== 'other';
      if (!other.hidden) other.focus();
    });
  }

  function textForm() {
    const fields = textFields(S.tpl);
    if (!fields.length) return `<p class="fxnote">${esc(t('{block} has no text to fix.', { block: S.spot.block }))}</p>`;
    return `<form class="fxform fxtext">${fields.map((f, i) => `<label class="fxlabel" for="fx-f${i}">${esc(f.label)}</label>${f.value.length > 60 ? `<textarea id="fx-f${i}" name="f${i}" rows="3">${esc(f.value)}</textarea>` : `<input id="fx-f${i}" name="f${i}" value="${esc(f.value)}">`}`).join('')}
      <div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button><button class="btn" type="button" data-fx="revert">${esc(t('Revert'))}</button></div></form>`;
  }

  function renderText() {
    el.innerHTML = `${head(t('All the text in {block}', { block: S.spot.block }), reach(S.spot.block, S.box))}${back()}${textForm()}${foot()}`;
  }

  function renderCode() {
    const { box } = S;
    el.innerHTML = `${head(t('{block}\'s code', { block: S.spot.block }), reach(S.spot.block, box))}${back()}
      <form class="fxform fxcode">
        <label class="fxlabel" for="fx-html">${esc(t('Markup'))}</label><textarea id="fx-html" name="html" spellcheck="false" rows="12">${esc(box.html)}</textarea>
        <label class="fxlabel" for="fx-css">${esc(t('Style (only this box gets it)'))}</label><textarea id="fx-css" name="css" spellcheck="false" rows="8">${esc(box.css)}</textarea>
        <div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button><button class="btn" type="button" data-fx="revert">${esc(t('Revert'))}</button></div>
      </form>${foot()}`;
  }

  function nodeOf(id, n = ctx.tree()) {
    if (!n) return null;
    if (n.id === id) return n;
    for (const c of n.children ?? []) {
      const f = nodeOf(id, c);
      if (f) return f;
    }
    return null;
  }

  function renderLook() {
    const n = nodeOf(S.spot.block) ?? {};
    const tone = (n.tags ?? []).find((x) => /^tone-/.test(x))?.slice(5) ?? '';
    el.innerHTML = `${head(t('{block}\'s size and look', { block: S.spot.block }))}${back()}
      <form class="fxform fxlook">
        <label class="fxlabel" for="fx-w">${esc(t('Widest it gets (px; empty: the whole width)'))}</label><input id="fx-w" name="w" type="number" min="120" step="10" value="${n.maxW ?? ''}">
        <label class="fxlabel" for="fx-h">${esc(t('Lowest it gets (px; empty: as tall as its content)'))}</label><input id="fx-h" name="h" type="number" min="0" step="10" value="${n.minH ?? ''}">
        <label class="fxlabel" for="fx-tone">${esc(t('Band'))}</label>
        <select id="fx-tone" name="tone">${[['', t('The page\'s own background')], ['alt', t('Alternate')], ['soft', t('Soft')], ['dark', t('Dark')]].map(([v, l]) => `<option value="${v}" ${tone === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <div class="row"><button class="btn primary" type="submit">${esc(t('Save'))}</button></div>
      </form>${foot()}`;
  }

  function renderTree() {
    const tree = ctx.tree();
    const counts = new Map();
    for (const x of ctx.tasks()) counts.set(x.block, (counts.get(x.block) ?? 0) + 1);
    const rows = [];
    const walk = (n, depth) => {
      if (depth > 0) rows.push({ n, depth });
      for (const c of n.children ?? []) walk(c, depth + 1);
    };
    if (tree) walk(tree, 0);
    const sel = S.selected;
    const box = sel && nodeOf(sel);
    const kind = (n) => (n.kind === 'box' ? t('box') : n.arrangement === 'row' ? t('row') : t('column'));
    el.innerHTML = `${head(t('The boxes of {page}', { page: ctx.page }), t('Choose a box to move, add beside, share or delete.'))}${S.spot ? back() : ''}
      <ul class="fxtree" role="listbox" aria-label="${esc(t('The boxes'))}">${rows.map(({ n, depth }) => `<li role="option" aria-selected="${n.id === sel}"><button type="button" data-box="${esc(n.id)}" style="padding-left:${10 + (depth - 1) * 16}px">
        <span class="bname">${esc(n.id)}</span><span class="kind">${esc(kind(n))}</span>${n.shared ? `<span class="tag">${esc(t('shared'))}</span>` : ''}${counts.get(n.id) ? `<span class="num">${counts.get(n.id)}</span>` : ''}</button></li>`).join('')}</ul>
      ${box ? `<div class="fxsel">
        <h3>${esc(sel)}</h3>
        <div class="row">
          <button type="button" class="btn small" data-op="up">${esc(t('Move up'))}</button>
          <button type="button" class="btn small" data-op="down">${esc(t('Move down'))}</button>
          <button type="button" class="btn small" data-op="below">${esc(t('Add below'))}</button>
          ${box.kind === 'box' && !box.shared ? `<button type="button" class="btn small" data-op="share">${esc(t('Share'))}</button>` : ''}
          <button type="button" class="btn small danger" data-op="delete">${esc(t('Delete'))}</button>
        </div>
        ${S.confirm === sel ? `<div class="confirm" role="alert"><p>${esc(t('Delete {block}? Its code goes into the box before it, and Undo brings it back.', { block: sel }))}</p><div class="row"><button type="button" class="btn small danger" data-op="delete-yes">${esc(t('Delete {block}', { block: sel }))}</button><button type="button" class="btn small" data-op="cancel">${esc(t('Cancel'))}</button></div></div>` : ''}
        ${box.kind === 'box' ? `<div class="row tabsrow"><button type="button" class="btn small" data-view="text" data-for="${esc(sel)}">${esc(t('Text'))}</button><button type="button" class="btn small" data-view="look" data-for="${esc(sel)}">${esc(t('Size & look'))}</button><button type="button" class="btn small" data-view="code" data-for="${esc(sel)}">${esc(t('Code'))}</button></div>` : ''}
      </div>` : ''}`;
    ctx.onChange();
  }

  function render() {
    if (!S) return;
    S.dirty = false;
    if (S.view === 'tree') return renderTree();
    if (S.view === 'text') return renderText();
    if (S.view === 'code') return renderCode();
    if (S.view === 'look') return renderLook();
    return renderElement();
  }

  /** The element as the code has it, when the page still shows exactly that. */
  function match() {
    const { spot, tpl } = S;
    S.code = spot.path ? atPath(tpl.content, spot.path) : null;
    const pageEl = spot.path ? ctx.frame.taskEl(spot.block, spot.path) : null;
    S.same = !spot.path || (S.code && (sameElement(pageEl, S.code) || sameImage(pageEl, S.code)));
  }

  async function show(spot, view = 'element') {
    const { box, tpl } = await load(spot.block);
    S = { ...S, view, spot, box, tpl, selected: S?.selected ?? spot.block };
    match();
    el.hidden = false;
    render();
    ctx.onChange();
    el.querySelector('input, textarea, select, button')?.focus();
  }

  async function save(id, html, css) {
    await ctx.api('/box', css === undefined ? { id, html } : { id, html, css });
    toast(t('Saved. Undo takes it back.'));
  }

  // what the person has typed and not saved yet: a refresh of the page doesn't wipe it
  el.addEventListener('input', () => S && (S.dirty = true));

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const id = S.spot.block;
    try {
      // the box as it is now (Kaity, another tab or an undo may have changed it): the fix goes into that code
      const fresh = await load(id);
      const fieldsBefore = textFields(S.tpl).length;
      Object.assign(S, fresh);
      match();
      if (f.classList.contains('fxform') && !f.classList.contains('fxcode') && !f.classList.contains('fxlook') && !f.classList.contains('fxtext') && (!S.same || !S.code))
        throw new Error(t('{block} changed meanwhile, so this fix was not saved: look at it again.', { block: id }));
      if (f.classList.contains('fxtext') && textFields(S.tpl).length !== fieldsBefore)
        throw new Error(t('{block} changed meanwhile, so this fix was not saved: look at it again.', { block: id }));
      if (f.classList.contains('fxcode')) await save(id, f.elements.html.value, f.elements.css.value);
      else if (f.classList.contains('fxlook')) {
        const w = f.elements.w.value.trim(), h = f.elements.h.value.trim(), tone = f.elements.tone.value || null;
        await ctx.api('/op', { op: 'width', id, px: w ? Number(w) : null });
        await ctx.api('/op', { op: 'height', id, px: h ? Number(h) : null });
        await ctx.api('/op', { op: 'look', id, tone });
        toast(t('Saved. Undo takes it back.'));
      } else if (f.classList.contains('fxtext')) {
        const fields = textFields(S.tpl);
        for (const [i, fd] of fields.entries()) {
          const v = f.elements[`f${i}`]?.value ?? fd.value;
          if (fd.link && !safeHref(v)) throw new Error(t('"{href}" can\'t be a link target', { href: v }));
          if (v !== fd.value) fd.set(v);
        }
        await save(id, S.tpl.innerHTML);
      } else {
        // the one element
        const { code } = S;
        if (f.elements.text) code.textContent = f.elements.text.value;
        if (f.elements.alt) code.setAttribute('alt', f.elements.alt.value);
        if (f.elements.href) {
          const href = f.elements.href.value === 'other' ? f.elements.other.value.trim() : f.elements.href.value;
          if (!safeHref(href)) throw new Error(t('"{href}" can\'t be a link target', { href }));
          code.setAttribute('href', href || '#');
        }
        await save(id, S.tpl.innerHTML);
      }
      // the page changes (SSE), and the panel reads the box again
      await reload();
    } catch (err) {
      failed(err);
    }
  });

  el.addEventListener('change', async (e) => {
    if (e.target.name !== 'picture' || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    try {
      const data = await new Promise((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => fail(r.error);
        r.readAsDataURL(file);
      });
      const { path } = await ctx.api('/asset', { data, box: S.spot.block });
      S.code.setAttribute('src', path);
      await save(S.spot.block, S.tpl.innerHTML);
      await reload();
    } catch (err) {
      failed(err);
    }
  });

  el.addEventListener('click', async (e) => {
    const fx = e.target.closest('[data-fx]')?.dataset.fx;
    if (fx === 'close') return api.close();
    if (fx === 'task') {
      const spot = S.spot;
      api.close();
      return ctx.toTask(spot);
    }
    if (fx === 'revert') return reload();
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) return ctx.setMode(mode);
    const v = e.target.closest('[data-view]');
    if (v) {
      const block = v.dataset.for;
      if (block && block !== S.spot?.block) return show({ block, path: null, label: '' }, v.dataset.view);
      S.view = v.dataset.view;
      return render();
    }
    const pick = e.target.closest('[data-box]')?.dataset.box;
    if (pick) {
      S.selected = pick;
      S.confirm = null;
      ctx.select(pick);
      return render();
    }
    const op = e.target.closest('[data-op]')?.dataset.op;
    if (!op) return;
    const id = S.selected;
    try {
      if (op === 'up' || op === 'down') await ctx.api('/op', { op: 'reorder', id, by: op === 'up' ? -1 : 1 });
      if (op === 'below') S.selected = (await ctx.api('/op', { op: 'insert', id, as: 'column' })).result ?? id;
      if (op === 'share') await ctx.api('/op', { op: 'share', id });
      if (op === 'delete') return (S.confirm = id), render();
      if (op === 'cancel') return (S.confirm = null), render();
      if (op === 'delete-yes') {
        await ctx.api('/op', { op: 'delete', id });
        S.confirm = null;
        S.selected = null;
      }
      await ctx.refreshTree();
      render();
    } catch (err) {
      failed(err);
    }
  });

  async function reload() {
    if (!S || S.dirty) return;
    if (S.view === 'tree') return render();
    const block = S.spot.block;
    if (!ctx.blocks().includes(block)) return S.view === 'tree' ? render() : api.close();
    const { box, tpl } = await load(block);
    Object.assign(S, { box, tpl });
    match();
    render();
  }

  const api = {
    el,
    isOpen: () => !el.hidden,
    /** What the bar says while fixing. */
    what: () => (S?.view === 'tree' ? t('the boxes of {page}', { page: ctx.page }) : S?.spot?.path ? plainLabel(S.spot.label) : S ? t('the {block} box', { block: S.spot.block }) : ''),
    open: (spot) => show(spot).catch(failed),
    tree(block) {
      S = { view: 'tree', spot: S?.spot ?? null, selected: block ?? null };
      el.hidden = false;
      renderTree();
    },
    close() {
      el.hidden = true;
      S = null;
      ctx.onClose();
    },
    reload: () => reload().catch(failed),
    get selected() {
      return S?.view === 'tree' ? S.selected : S?.spot?.block ?? null;
    },
    /** What the page outlines: the element being fixed, or the box chosen in the tree. */
    get target() {
      if (!S) return null;
      if (S.view === 'tree') return S.selected ? { block: S.selected, path: null } : null;
      return S.spot ? { block: S.spot.block, path: S.view === 'element' ? S.spot.path : null } : null;
    },
  };
  return api;
}
