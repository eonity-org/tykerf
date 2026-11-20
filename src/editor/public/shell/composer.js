// The one composer for everything said to Kaity (v4): the Overview's "Kaity lately", the Kaity center, a page's bar
// under the page, the task box and New page's Describe. It has what Kaity may change ("Kaity may change": This box,
// This page, Whole site), an Attach button (and dropping or pasting files on it) for pictures, PDFs and a design as a
// ZIP file, and Enter to send (Shift+Enter for a new line). What it sends and where is the caller's (`send`).

import { esc, failed, kaityMark, shrinkImage, t, toast } from './common.js';

export const PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const isZip = (f) => /\.zip$/i.test(f.name) || ['application/zip', 'application/x-zip-compressed'].includes(f.type);
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
/** What Attach takes: the file picker's filter. */
export const ACCEPT = [...PICTURES, 'application/pdf', '.pdf', '.zip', 'application/zip'].join(',');
const MAX = { picture: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024, zip: 8 * 1024 * 1024 };

/** A file read as base64. */
export const base64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => fail(r.error);
  r.readAsDataURL(file);
});

/**
 * Files as Kaity takes them ({ name, type, data }): pictures scaled down as Kaity's are, PDFs and ZIP files as they
 * are. Throws a sentence for the person when one can't go.
 */
export async function readFiles(files, room = 5) {
  const out = [];
  for (const f of files) {
    if (out.length >= room) throw new Error(t('At most {n} files', { n: room }));
    if (PICTURES.includes(f.type)) {
      if (f.size > MAX.picture * 4) throw new Error(t('{file} is larger than 20 MB', { file: f.name }));
      // scaled down as Kaity's pictures are; one the browser can't draw goes as it is (the server checks its bytes)
      const p = await shrinkImage(f).catch(async () => (f.size > MAX.picture ? Promise.reject(new Error(t('{file} is larger than 5 MB', { file: f.name }))) : { mediaType: f.type, data: await base64(f) }));
      out.push({ name: f.name || t('Picture'), type: p.mediaType, data: p.data, preview: `data:${p.mediaType};base64,${p.data}` });
    } else if (isPdf(f)) {
      if (f.size > MAX.pdf) throw new Error(t('{file} is larger than 10 MB', { file: f.name }));
      out.push({ name: f.name, type: 'application/pdf', data: await base64(f) });
    } else if (isZip(f)) {
      if (f.size > MAX.zip) throw new Error(t('{file} is larger than 8 MB', { file: f.name }));
      out.push({ name: f.name, type: 'application/zip', data: await base64(f) });
    } else throw new Error(t('{file}: Kaity reads pictures, PDFs and a design as a ZIP file', { file: f.name }));
  }
  return out;
}

const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>';
const DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>';
const PIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';

/** A file as a chip: its kind's mark and its name, with × to take it off. */
export const fileChip = (f, i, removable = true) => `<span class="fchip">${f.type?.startsWith('image/') ? PIC : DOC}<span>${esc(f.name)}</span>${removable ? `<button type="button" data-unfile="${i}" aria-label="${esc(t('Remove {file}', { file: f.name }))}">×</button>` : ''}</span>`;

/**
 * A composer. `scopes`: [{ key, label }] for "Kaity may change" (none: no chips); `scope`: the chosen one;
 * `placeholder(scope)`; `send({ prompt, files, scope })` (a promise; the composer empties when it resolves);
 * `submit`: the button's words; `compact`: one line (the Overview); `line`: one line docked under a page (round 2),
 * Kaity's mark, the words, "Kaity may change" as a drop-down, Attach as an icon and Ask, growing while you type or
 * attach; `max`: how many files.
 */
export function createComposer({ scopes = [], scope = scopes[0]?.key, placeholder = () => t('Ask Kaity…'), send, submit = () => t('Ask Kaity'), compact = false, line = false, max = 5, label = t('Ask Kaity'), keepFiles = false }) {
  const el = document.createElement('form');
  el.className = `composer${compact ? ' compact' : ''}${line ? ' line' : ''}`;
  el.setAttribute('aria-label', label);
  const S = { scopes, scope, files: [], busy: false, text: '' };

  function render() {
    const typed = el.querySelector('textarea');
    if (typed) S.text = typed.value;
    const focused = document.activeElement === typed;
    const at = typed?.selectionStart ?? S.text.length;
    el.classList.toggle('aimed', S.scope === 'box');
    if (line) {
      el.innerHTML = `
        ${S.files.length ? `<div class="kfiles">${S.files.map((f, i) => fileChip(f, i)).join('')}</div>` : ''}
        <div class="cline">
          <span class="cmark" aria-hidden="true">${kaityMark(S.busy, true)}</span>
          <textarea name="prompt" rows="1" aria-label="${esc(label)}" placeholder="${esc(placeholder(S.scope))}">${esc(S.text)}</textarea>
          ${S.scopes.length > 1 ? `<label class="cscope"><span class="vh">${esc(t('Kaity may change'))}</span><select data-scope-select title="${esc(t('Kaity may change'))}">${S.scopes.map((s) => `<option value="${esc(s.key)}" ${s.key === S.scope ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>` : ''}
          <button type="button" class="btn icon attach" data-c="attach" ${S.files.length >= max ? 'disabled' : ''} aria-label="${esc(t('Attach'))}" title="${esc(t('Attach pictures, PDFs or a design as a ZIP file (or drop or paste them here)'))}">${CLIP}</button>
          <button type="submit" class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(submit(S.scope))}</button>
        </div>`;
      grow();
      if (focused) {
        const ta = el.querySelector('textarea');
        ta.focus();
        ta.setSelectionRange(at, at);
      }
      return;
    }
    el.innerHTML = `
      ${S.scopes.length > 1 ? `<div class="kscope" role="group" aria-label="${esc(t('Kaity may change'))}"><span>${esc(t('Kaity may change'))}</span>${S.scopes.map((s) => `<button type="button" class="chip" data-scope="${esc(s.key)}" aria-pressed="${s.key === S.scope}">${esc(s.label)}</button>`).join('')}</div>` : ''}
      <textarea name="prompt" rows="${compact ? 1 : 2}" aria-label="${esc(label)}" placeholder="${esc(placeholder(S.scope))}">${esc(S.text)}</textarea>
      <div class="kfoot">
        <button type="button" class="btn attach" data-c="attach" ${S.files.length >= max ? 'disabled' : ''} aria-label="${esc(t('Attach'))}" title="${esc(t('Attach pictures, PDFs or a design as a ZIP file (or drop or paste them here)'))}">${CLIP}<span>${esc(t('Attach'))}</span></button>
        ${S.files.map((f, i) => fileChip(f, i)).join('')}
        <span class="khint">${esc(t('Enter to send · Shift+Enter for a new line'))}</span>
        <button type="submit" class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(submit(S.scope))}</button>
      </div>`;
    if (focused) {
      const ta = el.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(at, at);
    }
  }

  /** The one line grows with what is typed (up to a few lines), and goes back to one line when it is sent. */
  function grow() {
    const ta = el.querySelector('textarea');
    if (!line || !ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }

  async function add(list) {
    try {
      S.files.push(...(await readFiles(list, max - S.files.length)));
    } catch (e) {
      toast(e.message, true);
    }
    render();
  }

  async function go() {
    const prompt = (el.querySelector('textarea')?.value ?? '').trim();
    if (!prompt && !S.files.length) return el.querySelector('textarea').focus();
    S.busy = true;
    render();
    try {
      await send({ prompt, files: S.files.map(({ name, type, data }) => ({ name, type, data })), scope: S.scope });
      S.text = '';
      if (!keepFiles) S.files = [];
      el.querySelector('textarea').value = '';
    } catch (e) {
      failed(e);
    }
    S.busy = false;
    render();
  }

  el.addEventListener('submit', (e) => (e.preventDefault(), go()));
  el.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) (e.preventDefault(), go());
  });
  el.addEventListener('input', (e) => {
    if (e.target.matches('textarea')) (S.text = e.target.value), grow();
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-scope-select]')) (S.scope = e.target.value), render(), el.querySelector('textarea').focus();
  });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-scope]')?.dataset.scope;
    if (s) return (S.scope = s), render(), el.querySelector('textarea').focus();
    if (e.target.closest('[data-c="attach"]')) {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, multiple: true });
      input.onchange = () => add([...input.files]);
      return input.click();
    }
    const un = e.target.closest('[data-unfile]');
    if (un) return S.files.splice(Number(un.dataset.unfile), 1), render();
  });
  el.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) (e.preventDefault(), add(files));
  });
  el.addEventListener('dragover', (e) => (e.preventDefault(), el.classList.add('drop')));
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    add([...(e.dataTransfer?.files ?? [])]);
  });
  render();

  return {
    el,
    focus: () => el.querySelector('textarea').focus(),
    /** New choices for "Kaity may change" (a box selected, the page changed); the chosen one stays if it can. */
    setScopes(next, want) {
      S.scopes = next;
      S.scope = next.some((s) => s.key === (want ?? S.scope)) ? (want ?? S.scope) : next[0]?.key;
      render();
    },
    get scope() {
      return S.scope;
    },
    set text(v) {
      S.text = v;
      render();
    },
    get files() {
      return S.files;
    },
  };
}
