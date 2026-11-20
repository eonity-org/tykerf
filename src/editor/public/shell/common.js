// What the v3 editor's modules share: words (t), escaping, the browser's storage, the toast, requests, and the
// marks. English text is the key (public/i18n/<lang>.json), as in the rest of tykerf.

export const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(`tykerf.${k}`)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`tykerf.${k}`, JSON.stringify(v)); } catch {} },
};

const LANG = String(store.get('lang', null) ?? navigator.language ?? 'en').slice(0, 2).toLowerCase();
const CATALOG = LANG === 'en' ? {} : await fetch(`/_tykerf/i18n/${LANG}.json`).then((r) => r.json()).catch(() => ({}));
export const t = (text, vars = {}) => (CATALOG[text] || text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** A request to tykerf: GET without a body, POST with one (JSON); its answer, or an error with the server's words. */
export async function request(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

let toastTimer = 0;
export function toast(text, bad = false) {
  const el = $('.toast');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 3500);
}
export const failed = (e) => toast(e.message, true);

/** "the button "Get started free"" from a task's label (`a "Get started free"`), for people to read. */
const KIND = {
  a: ['the link "{words}"', 'the link'], button: ['the button "{words}"', 'the button'], img: ['the picture "{words}"', 'the picture'],
  h1: ['the heading "{words}"', 'the heading'], h2: ['the heading "{words}"', 'the heading'], h3: ['the heading "{words}"', 'the heading'],
  h4: ['the heading "{words}"', 'the heading'], h5: ['the heading "{words}"', 'the heading'], h6: ['the heading "{words}"', 'the heading'],
  p: ['the paragraph "{words}"', 'the paragraph'], li: ['the item "{words}"', 'the item'], ul: ['the list "{words}"', 'the list'], ol: ['the list "{words}"', 'the list'],
  input: ['the field "{words}"', 'the field'], textarea: ['the field "{words}"', 'the field'], select: ['the field "{words}"', 'the field'], label: ['the label "{words}"', 'the label'],
  nav: ['the navigation "{words}"', 'the navigation'], form: ['the form "{words}"', 'the form'], table: ['the table "{words}"', 'the table'], blockquote: ['the quote "{words}"', 'the quote'],
  figure: ['the figure "{words}"', 'the figure'], svg: ['the drawing "{words}"', 'the drawing'], video: ['the video "{words}"', 'the video'],
};
export function plainLabel(label) {
  if (!label) return t('the whole box');
  const m = /^([a-z0-9-]+)(?: "([\s\S]*)")?$/.exec(label);
  if (!m) return label;
  const [withWords, alone] = KIND[m[1]] ?? ['the text "{words}"', 'this part'];
  return m[2] ? t(withWords, { words: m[2] }) : t(alone);
}

export const MARK = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="20" rx="6" fill="currentColor"/><rect y="27" width="28.5" height="37" rx="6" fill="currentColor"/><rect x="35.5" y="27" width="28.5" height="12" rx="3" fill="#EA9A27"/><rect x="35.5" y="45" width="11.25" height="19" rx="3" fill="currentColor"/><rect x="52.75" y="45" width="11.25" height="19" rx="3" fill="currentColor"/></svg>';
export const CHEVRON = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const KAITY_BALLS = [['15.3', '4.5', '0.4s'], ['8.1', '3.6', '0.2s'], ['2.7', '2.7', '0s']];
const KAITY_LIGHT = ['#8FD0EC', '#5295B3', '#287C9C']; // on the bar
const KAITY_REST = ['#1A5D7D', '#287C9C', '#5295B3']; // on a light ground
const KAITY_WORKING = ['#ffffff', '#8fd0ec', '#1cb0d2'];
export const stillMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Kaity's three balls; `working` pulses them (on the bar), `light` is for a light ground. */
export const kaityMark = (working = false, light = false) => `<span class="kaity" aria-hidden="true"><svg viewBox="-0.25 -0.125 20.5 10.25">${KAITY_BALLS.map(([cx, r, delay], i) =>
  `<circle cx="${cx}" cy="5" r="${r}" fill="${(working ? KAITY_WORKING : light ? KAITY_REST : KAITY_LIGHT)[i]}">${working && !stillMotion
    ? `<animate attributeName="fill-opacity" values="1;1;0.4;1" dur="1s" begin="${delay}" repeatCount="indefinite"/>` : ''}</circle>`).join('')}</svg></span>`;

/**
 * The online guides (the user guide on GitHub until they move to eonity.org: change this one address then). Each
 * "Learn tykerf" link is a page of it.
 */
export const DOCS = 'https://github.com/eonity-org/tykerf/blob/main/docs/user-guide/en';
/** The Overview's "Learn tykerf" strip. */
export const DOC_LINKS = () => [
  ['getting-started.md', t('Getting started')], ['editor.md', t('Pages and blocks')], ['asking-kaity.md', t('Working with Kaity')],
  ['sites.md', t('Shared blocks')], ['publishing.md', t('Publishing')],
];
/** The first run's Documentation card: the same guides, said a little longer. */
export const DOC_CARD = () => [
  ['getting-started.md', t('Getting started (5 min)')], ['sites.md', t('Pages, blocks and shared blocks')], ['asking-kaity.md', t('Working with Kaity')],
  ['layouts.md', t('Themes and the look of the site')], ['publishing.md', t('Publishing your site')],
];
export const docLink = (file) => `${DOCS}/${file}`;

/** When something happened, in words: "just now", "5 minutes ago", or the date. */
export function when(at) {
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if (!(s >= -60)) return '';
  if (s < 60) return t('just now');
  if (s < 3600) return Math.round(s / 60) === 1 ? t('a minute ago') : t('{n} minutes ago', { n: Math.round(s / 60) });
  if (s < 86400) return Math.round(s / 3600) === 1 ? t('an hour ago') : t('{n} hours ago', { n: Math.round(s / 3600) });
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** The one way tykerf says when (v4 round 2): relative under a day, the date beyond, the exact time on hover. */
export const stamp = (at) => (at ? `<time datetime="${esc(at)}" title="${esc(new Date(at).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))}">${esc(when(at))}</time>` : '');

/** A file's size in words. */
export const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** Pages whose copies of a picture the site has too (the same name and size): "kept twice". */
export function keptTwice(files = []) {
  const site = new Map(files.filter((f) => f.where === 'site').map((f) => [f.file, f.bytes]));
  return files.filter((f) => f.where !== 'site' && site.get(f.file) === f.bytes);
}

/** The pages nothing links to (besides the home page): hard to reach. */
export function hardToReach(pages = [], links = [], home = null) {
  const to = new Set(links.filter((l) => !l.broken && l.to !== l.page).map((l) => l.to));
  return pages.filter((p) => p !== home && !to.has(p));
}

/**
 * Tell when tykerf changed under this tab: its server code (restart it), or the browser part this tab loaded (reload
 * it). Asked on opening, and again whenever the person comes back to the tab.
 */
export function watchVersion() {
  let loaded = null;
  const note = document.createElement('p');
  note.className = 'outdated';
  note.setAttribute('role', 'alert');
  note.hidden = true;
  document.querySelector('.bar').after(note);
  const check = async () => {
    const v = await request('/_tykerf/version').catch(() => null);
    if (!v) return;
    loaded ??= v.page;
    if (v.outdated) {
      note.innerHTML = esc(t('TYKERF was updated while this editor was running. Restart it to use the new version: Ctrl+C in its terminal, then npm start again.'));
      note.hidden = false;
    } else if (v.page !== loaded) {
      note.innerHTML = `${esc(t('tykerf was updated: reload this page to use the new version.'))} <button type="button" class="btn small reload">${esc(t('Reload'))}</button>`;
      note.querySelector('.reload').onclick = () => location.reload();
      note.hidden = false;
    } else note.hidden = true;
  };
  void check();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  addEventListener('focus', check);
}

/**
 * Read a picture for Kaity, scaled down so its long side is at most 1568 px (larger ones are scaled down by the
 * model anyway and only cost more): { mediaType, data (base64) }.
 */
export async function shrinkImage(file) {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error(file.name ? t('Could not read {name}', { name: file.name }) : t('Could not read the image'));
  });
  const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const mediaType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const url = c.toDataURL(mediaType, 0.9);
  return { mediaType, data: url.slice(url.indexOf(',') + 1) };
}
