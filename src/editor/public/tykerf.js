// TYKERF client. Everything it draws lives in one shadow root, so the site's CSS cannot restyle
// the editor and the editor's CSS cannot touch the site. The page itself is never edited here:
// every change is a named operation sent to the server, and the page is re-rendered from the tree.

import { atPath, cleanInline, editableAt, elementPath, fitAspect, moveCrop, outputSize, resizeCrop, safeHref, sameImage, turned } from './inline.js';
import { markdown } from './markdown.js';

// the page's own API: "/_tykerf" for a single page, "/<page>/_tykerf" for a page of a site
const API = `${location.pathname.replace(/[^/]*$/, '')}_tykerf`;
const $ = (sel, el = ui) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(`tykerf.${k}`)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`tykerf.${k}`, JSON.stringify(v)); } catch {} },
};

// ---------- language ----------
// UI text is written in English and wrapped in t(): the English text is the key. A catalog
// (public/i18n/<lang>.json, { "English text": "translation" }) replaces it for the browser's language;
// a missing language or entry falls back to English. {name} placeholders are filled from vars, which
// must already be escaped when they go into HTML.
const LANG = String(store.get('lang', null) ?? navigator.language ?? 'en').slice(0, 2).toLowerCase();
const CATALOG = LANG === 'en' ? {} : await fetch(`${API}/i18n/${LANG}.json`).then((r) => r.json()).catch(() => ({}));
const t = (text, vars = {}) => (CATALOG[text] || text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- state ----------

const S = {
  on: store.get('on', false),
  view: store.get('view', 'dim'), // dim | blur
  open: new Set(store.get('open', [])), // expanded containers in the tree
  min: store.get('min', false),
  tree: null,
  nodes: new Map(), // id -> { node, parent, depth }
  sel: null,
  hover: null,
  ai: null, // { id } while the AI works
  canUndo: false,
  buffer: [], // code taken out with Remove, newest first
  lastChange: null,
  nextRedo: null, // the label of the step redo would bring back
  per: new Map(), // per block: { tab, codeTab, box, text, code, sheet, aiDraft }
  tasks: [], // tasks left on the page (src/tasks.ts), every one, done too
  tasksText: '', // the open ones in words, for copying to any agent
  taskMode: false, // task mode: a click on the page adds a task there
  showPins: store.get('pins', true),
  taskAt: null, // in task mode, what the pointer is on: { el, block }
  taskTarget: null, // the element whose task is being written
  kit: { site: false, blocks: [], tags: {}, users: {} }, // the site kit: shared blocks (and the pages that show them), the site's own tags
};
const per = (id) => {
  if (!S.per.has(id)) S.per.set(id, {});
  return S.per.get(id);
};
const info = (id) => S.nodes.get(id);
const isBox = (id) => info(id)?.node.kind === 'box';

// ---------- shadow root ----------

const host = document.createElement('tykerf-root');
host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647';
const ui = host.attachShadow({ mode: 'open' });
const sheet = new CSSStyleSheet();
sheet.replaceSync(await (await fetch(`${API}/tykerf.css`)).text());
ui.adoptedStyleSheets = [sheet];

const ICON = {
  // a container shows its cut: side by side = vertical line, stacked = horizontal line
  row: '<svg viewBox="0 0 12 12"><rect x=".5" y=".5" width="11" height="11" rx="2"/><path d="M6 .5v11"/></svg>',
  column: '<svg viewBox="0 0 12 12"><rect x=".5" y=".5" width="11" height="11" rx="2"/><path d="M.5 6h11"/></svg>',
  periphery: '<svg viewBox="0 0 12 12"><rect x=".5" y=".5" width="11" height="11" rx="2"/><path d="M.5 3.5h11M.5 8.5h11M3.5 3.5v5M8.5 3.5v5"/></svg>',
  box: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/></svg>',
  chevron: '<svg viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>',
  // the TYKERF mark (small-size drawing): the tree 5 1 4 2 3 V H V H, cell 4 (amber) = the block in focus
  tykerf: '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="20" rx="6"/><rect y="27" width="28.5" height="37" rx="6"/><rect class="focus" x="35.5" y="27" width="28.5" height="12" rx="3"/><rect x="35.5" y="45" width="11.25" height="19" rx="3"/><rect x="52.75" y="45" width="11.25" height="19" rx="3"/></svg>',
};

/** Line icons next to the labels: 16px, stroke = currentColor. */
const UI = {
  beside: '<rect x="1.5" y="2.5" width="7" height="11" rx="1.5"/><path d="M12 5.5v5M9.5 8h5"/>',
  below: '<rect x="2.5" y="1.5" width="11" height="7" rx="1.5"/><path d="M8 10v5M5.5 12.5h5"/>',
  inside: '<rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M8 5v6M5 8h6"/>',
  flip: '<path d="M2 5.5h10L9.5 3M14 10.5H4L6.5 13"/>',
  left: '<path d="M10 3 5 8l5 5"/>', right: '<path d="m6 3 5 5-5 5"/>', up: '<path d="m3 10 5-5 5 5"/>', down: '<path d="m3 6 5 5 5-5"/>',
  ungroup: '<rect x="1.5" y="1.5" width="6" height="6" rx="1"/><rect x="8.5" y="8.5" width="6" height="6" rx="1"/>',
  rename: '<path d="M3 13.5h10M4 10.5l6.5-6.5 2 2L6 12.5H4z"/>',
  paste: '<path d="M5.5 2h5v2.5h-5zM5 3.5H3.5v10.5h9V3.5H11"/>',
  import: '<path d="M8 1.5v7.5M5 6l3 3 3-3"/><path d="M2.5 9.5v3.5h11V9.5"/>',
  // three pages fanned out: the whole site; the front one (filled, with the mark's amber) is the page you're on
  site: '<path d="M7 1.5h6a1.5 1.5 0 0 1 1.5 1.5v6"/><path d="M4.25 4.25h6.25a1.5 1.5 0 0 1 1.5 1.5v6.25"/><rect x="1.5" y="7" width="8" height="7.5" rx="1.5" fill="currentColor"/><rect class="here" x="3.5" y="9" width="4" height="2" rx=".6"/>',
  download: '<path d="M8 2v8M4.5 7 8 10.5 11.5 7"/><path d="M2.5 13.5h11"/>',
  delete: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>',
  text: '<path d="M3 3.5h10M8 3.5v10"/>',
  code: '<path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4"/>',
  size: '<path d="M1.5 8h13M1.5 8 4 5.5M1.5 8 4 10.5M14.5 8 12 5.5M14.5 8 12 10.5"/>',
  ai: '<path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4z"/>',
  blocks: '<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="13" height="5.5" rx="1"/>',
  parent: '<path d="M8 14V4M4 7.5 8 3.5l4 4"/>',
  undo: '<path d="M4.5 6.5h6a3.5 3.5 0 0 1 0 7H6M4.5 6.5 7.5 3.5M4.5 6.5l3 3"/>',
  redo: '<path d="M11.5 6.5h-6a3.5 3.5 0 0 0 0 7H10M11.5 6.5 8.5 3.5M11.5 6.5l-3 3"/>',
  image: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.3"/><path d="m2 12 4-4 3 3 2-2 3.5 3.5"/>',
  page: '<path d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.3-1.2h1.6a2.9 2.9 0 0 0 2.9-2.9C14.5 4 11.6 1.5 8 1.5z"/><circle cx="4.8" cy="7.2" r=".9"/><circle cx="7.2" cy="4.6" r=".9"/><circle cx="10.4" cy="5" r=".9"/>',
  component: '<rect x="1.5" y="1.5" width="13" height="4" rx="1"/><rect x="1.5" y="7.5" width="6" height="7" rx="1"/><rect x="9.5" y="7.5" width="5" height="7" rx="1"/>',
  // a task on the page: a box with a check in it
  task: '<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="m5 8.2 2.1 2.1L11.2 6"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 5.5V3A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v6.5A1.5 1.5 0 0 0 3.5 11h2"/>',
  list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.5" cy="4" r=".6"/><circle cx="2.5" cy="8" r=".6"/><circle cx="2.5" cy="12" r=".6"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  check: '<path d="m3 8.5 3 3 7-7"/>',
};
const ic = (name) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${UI[name]}</svg>`;
/**
 * Kaity's symbol: the three balls of eonity's isotype (as Tydal's Kaity indicator), at the logo's own
 * geometry. At rest, the logo's blues; while Kaity works, a brighter set that pulses back to front and
 * breathes (radius +7%). Still when the system asks for reduced motion.
 */
const KAITY_BALLS = [['15.3', '4.5', '0.4s'], ['8.1', '3.6', '0.2s'], ['2.7', '2.7', '0s']]; // large, medium, small: cx, r, delay
const KAITY_REST = ['#1A5D7D', '#287C9C', '#5295B3'];
const KAITY_WORKING = ['#0a4f6e', '#0e7ea0', '#1cb0d2'];
const stillMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const kaityMark = (working = false) => `<span class="kaity${working ? ' working' : ''}" aria-hidden="true"><svg viewBox="-0.25 -0.125 20.5 10.25">${KAITY_BALLS.map(([cx, r, delay], i) =>
  `<circle cx="${cx}" cy="5" r="${r}" fill="${(working ? KAITY_WORKING : KAITY_REST)[i]}">${working && !stillMotion
    ? `<animate attributeName="fill-opacity" values="1;1;0.4;1" dur="1s" begin="${delay}" repeatCount="indefinite"/><animate attributeName="r" values="${r};${(+r * 1.07).toFixed(2)};${r}" dur="1s" begin="${delay}" repeatCount="indefinite"/>` : ''}</circle>`).join('')}</svg></span>`;
const TAB_ICON = { text: 'text', code: 'code', size: 'size', ai: 'ai', blocks: 'blocks', page: 'page' };

// a page open in the editor shows TYKERF's mark in its tab (visitors get the site's own icon)
for (const l of document.querySelectorAll('link[rel~="icon"]')) l.remove();
document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: '/_tykerf/favicon.svg' }));

// IBM Plex Sans + Plex Mono, bundled with TYKERF (V2/public/fonts, SIL OFL) and served from /_tykerf/fonts, so the
// page never contacts a font CDN (no visitor IP sent to a third party). @font-face only works when declared in the
// document, not in a shadow root; the families get TYKERF-only names so they can't clash with the site's own fonts.
if (!document.querySelector('style[data-tykerf-font]')) {
  const face = (family, file, weight) =>
    `@font-face{font-family:'${family}';src:url('/_tykerf/fonts/${file}-Latin1.woff2') format('woff2');font-weight:${weight};font-style:normal;font-display:swap}`;
  const sans = { Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };
  const mono = { Regular: 400, Medium: 500, SemiBold: 600 };
  const style = document.createElement('style');
  style.dataset.tykerfFont = '';
  style.textContent = [
    ...Object.entries(sans).map(([w, n]) => face('tykerf-plex-sans', `IBMPlexSans-${w}`, n)),
    ...Object.entries(mono).map(([w, n]) => face('tykerf-plex-mono', `IBMPlexMono-${w}`, n)),
  ].join('\n');
  document.head.append(style);
}

ui.innerHTML = `
<div class="layer" part="layer">
  <div class="shade" data-s="t"></div><div class="shade" data-s="b"></div><div class="shade" data-s="l"></div><div class="shade" data-s="r"></div>
  <svg class="frame sel"><rect class="under"/><rect class="over"/></svg>
  <div class="handles"></div>
  <div class="hhandles"></div>
  <div class="whandle" title="${t('Drag to make it narrower (it stays centred) · double-click: full width')}"><i></i><span></span></div>
  <div class="hover"><svg class="frame"><rect class="under"/><rect class="ants"/></svg><span class="tag"></span></div>
  <div class="nhover"><span class="tag"></span></div>
  <div class="pins"></div>
  <div class="kwork" aria-hidden="true"></div>
</div>
<div class="dock">
  <a class="managebtn" href="/_tykerf/site/" hidden title="${t('Manage the site: its pages, home page, styles and trash')}">${ic('site')}<span>${t('Manage the site')}</span></a>
  <button class="toggle" title="${t('TYKERF: edit this page with people and Kaity')}">${ICON.tykerf}<span>${t('Edit with TYKERF')}</span></button>
</div>
<div class="outdated" role="alert" hidden><span>${t('TYKERF was updated while this editor was running. Restart it to use the new version: Ctrl+C in its terminal, then npm start again.')}</span><button aria-label="${t('Close')}">×</button></div>
<section class="panel" role="dialog" aria-label="TYKERF">
  <header class="head">
    <span class="brand" title="TYKERF">${ICON.tykerf}<span class="wordmark">tykerf</span></span>
    <button class="sitebtn" aria-haspopup="menu" title="${t('Site: export and Kaity')}" aria-label="${t('Site')}">${ic('site')}</button>
    <button class="pagesw" hidden aria-haspopup="menu" title="${t('The pages of this site')}"></button>
    <nav class="path" aria-label="${t('path')}"></nav>
    <div class="head-tools">
      <div class="seg" role="radiogroup" aria-label="${t('outside the selection')}">
        <button data-view="dim" title="${t('Darken everything outside the selection')}">${t('Dim')}</button>
        <button data-view="blur" title="${t('Blur everything outside the selection (for colourful pages)')}">${t('Blur')}</button>
      </div>
      <button class="tasksbtn" aria-pressed="false" title="${t('Tasks: point at anything on the page and leave a task there, for you, a colleague or Kaity')}">${ic('task')}<span class="label">${t('Tasks')}</span><span class="count" hidden></span></button>
      <button class="undo" title="${t('Undo the last change (⌘Z)')}" aria-label="${t('Undo')}">${ic('undo')}<span class="label">${t('Undo')}</span></button>
      <button class="redo" title="${t('Redo (⇧⌘Z)')}" aria-label="${t('Redo')}">${ic('redo')}<span class="label">${t('Redo')}</span></button>
      <button class="minimize" title="${t('Collapse / expand the panel')}">–</button>
    </div>
  </header>
  <div class="body">
    <nav class="tree" aria-label="${t('page tree')}"></nav>
    <main class="work"></main>
  </div>
  <div class="toast" role="status"></div>
</section>
<div class="taskbar" role="toolbar" aria-label="${t('Tasks')}" hidden>
  <span class="nb-say">${ic('task')}<span></span></span>
  <button data-nb="list" title="${t('Every task on this page')}">${ic('list')}<span>${t('List')}</span></button>
  <button data-nb="pins" title="${t('Show or hide the task tabs on the page')}">${ic('eye')}<span>${t('Tabs')}</span></button>
  <button data-nb="copy" title="${t('Copy the open tasks as text, to give them to any AI agent or a colleague')}">${ic('copy')}<span>${t('Copy all')}</span></button>
  <button data-nb="done" class="primary" title="${t('Leave task mode (Esc)')}">${t('Done')}</button>
</div>
<div class="menu" role="menu" hidden></div>
<div class="pop" role="dialog" hidden></div>
<div class="tbar" role="toolbar" aria-label="${t('Text formatting')}" hidden>
  <button data-fmt="bold" title="${t('Bold (⌘B)')}"><b>B</b></button>
  <button data-fmt="italic" title="${t('Italic (⌘I)')}"><i>I</i></button>
  <button data-fmt="link" title="${t('Link (⌘K)')}">${t('Link')}</button>
  <button data-fmt="cancel" title="${t('Cancel (Esc)')}">${t('Cancel')}</button>
  <button data-fmt="done" class="primary" title="${t('Save (Enter)')}">${t('Done')}</button>
</div>
<section class="imgtool" role="dialog" aria-label="${t('Image')}" hidden></section>
<section class="newpage" role="dialog" aria-modal="true" aria-label="${t('New page')}" hidden><div class="np-box"></div></section>
<section class="jobmodal" role="dialog" aria-modal="true" aria-live="polite" hidden><div class="job-box"></div></section>
<input class="imgfile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden>`;
document.body.appendChild(host);

const layer = $('.layer');
const panel = $('.panel');
const page = () => document.getElementById('sw--page');

// ---------- geometry ----------

function elOf(id) {
  return page()?.querySelector(`[data-sw="${CSS.escape(id)}"]`) ?? null;
}

/** A block's rectangle in document coordinates, or null when it is not on screen (hidden at this width). */
function rectOf(id) {
  const el = elOf(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
}

function placeFrame(svg, r) {
  if (!r) return (svg.style.display = 'none');
  Object.assign(svg.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  // The stroke is drawn inside the rectangle, so the frame never covers the neighbours.
  for (const rect of svg.querySelectorAll('rect')) {
    const sw = 2;
    rect.setAttribute('x', sw / 2);
    rect.setAttribute('y', sw / 2);
    rect.setAttribute('width', Math.max(0, r.w - sw));
    rect.setAttribute('height', Math.max(0, r.h - sw));
  }
}

function draw() {
  layer.hidden = !S.on;
  if (!S.on) return;
  const de = document.documentElement;
  const W = Math.max(de.scrollWidth, innerWidth), H = Math.max(de.scrollHeight, innerHeight);
  Object.assign(layer.style, { width: `${W}px`, height: `${H}px` });
  layer.dataset.view = S.view;
  const isRoot = S.sel === S.tree?.id;
  // in task mode the whole page is for pointing: no shade, no selection
  const r = S.sel && !isRoot && !S.taskMode ? rectOf(S.sel) : null;
  const shade = (k, x, y, w, h) => Object.assign(layer.querySelector(`[data-s="${k}"]`).style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
  if (r) {
    shade('t', 0, 0, W, r.y);
    shade('b', 0, r.y + r.h, W, H - r.y - r.h);
    shade('l', 0, r.y, r.x, r.h);
    shade('r', r.x + r.w, r.y, W - r.x - r.w, r.h);
  } else for (const k of 'tblr') shade(k, 0, 0, 0, 0);
  placeFrame($('.frame.sel'), r);
  const hv = $('.hover');
  const hr = S.hover && S.hover !== S.sel && !S.taskMode ? rectOf(S.hover) : null;
  hv.style.display = hr ? 'block' : 'none';
  if (hr) {
    Object.assign(hv.style, { left: `${hr.x}px`, top: `${hr.y}px`, width: `${hr.w}px`, height: `${hr.h}px` });
    placeFrame(hv.querySelector('svg'), { x: 0, y: 0, w: hr.w, h: hr.h });
    hv.querySelector('.tag').textContent = S.hover;
    hv.classList.toggle('tag-inside', hr.y < 22);
  }
  drawTasks();
  drawKaity();
  drawHandles();
  drawHeightHandles();
  drawWidthHandle();
  placeToolbar();
  placeTool();
}

let raf = 0;
const redraw = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
};
addEventListener('resize', () => { redraw(); keepPanelOnScreen(); });
addEventListener('scroll', redraw, { passive: true });
new ResizeObserver(redraw).observe(document.documentElement);

// ---------- sizes: handles on the page and sliders in the panel ----------
// Only blocks side by side (a row) have a size to share: in a column each block takes the height
// its content needs. A preview restyles the page while dragging; the tree changes on release.

/** The row the selection sizes: the selected row itself, else the nearest row around it. */
function sizingRow(id) {
  const n = info(id)?.node;
  if (n?.kind === 'container' && n.arrangement === 'row' && n.children.length > 1) return n;
  for (let p = info(id)?.parent; p; p = info(p.id)?.parent) if (p.arrangement === 'row' && p.children.length > 1) return p;
  return null;
}
const weightsOf = (row) => (preview?.row === row.id ? preview.weights : row.ratios ?? row.children.map(() => 1));
const shares = (ws) => {
  const sum = ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => Math.round((100 * w) / sum));
};
let preview = null; // { row, weights } while the user drags or slides

function childEl(rowId, childId) {
  const row = elOf(rowId);
  const q = CSS.escape(childId);
  return row?.querySelector(`:scope > [data-slot="${q}"], :scope > [data-sw="${q}"]`) ?? null;
}

function previewWeights(row, ws) {
  preview = { row: row.id, weights: [...ws] };
  row.children.forEach((c, i) => {
    const el = childEl(row.id, c.id);
    if (el) el.style.flexGrow = ws[i];
  });
  redraw();
}

async function commitWeights(row, ws) {
  const equal = ws.every((w) => Math.abs(w - ws[0]) < 1e-3);
  const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
  await op({ op: 'ratios', id: row.id, ratios: equal ? null : ws.map((w) => w / mean) }); // weights around 1
  preview = null;
}

const handlesEl = layer.querySelector('.handles');
function drawHandles() {
  const row = S.on && S.sel && !S.taskMode ? sizingRow(S.sel) : null;
  const els = row ? row.children.map((c) => childEl(row.id, c.id)?.getBoundingClientRect()) : [];
  const want = Math.max(0, els.length - 1);
  while (handlesEl.children.length > want) handlesEl.lastChild.remove();
  while (handlesEl.children.length < want) handlesEl.insertAdjacentHTML('beforeend', `<div class="handle" title="${t('Drag to share the width')}"><i></i><span></span></div>`);
  if (!row) return;
  const ws = weightsOf(row);
  const pct = shares(ws);
  [...handlesEl.children].forEach((h, i) => {
    const a = els[i], b = els[i + 1];
    if (!a || !b || !a.width || !b.width) return (h.style.display = 'none');
    const top = Math.min(a.top, b.top) + scrollY, bottom = Math.max(a.bottom, b.bottom) + scrollY;
    Object.assign(h.style, { display: 'block', left: `${(a.right + b.left) / 2 + scrollX - 7}px`, top: `${top}px`, height: `${bottom - top}px` });
    h.dataset.i = i;
    h.querySelector('span').textContent = `${pct[i]}% · ${pct[i + 1]}%`;
  });
}

handlesEl.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.handle');
  const row = S.sel && sizingRow(S.sel);
  if (!h || !row || e.button !== 0) return;
  e.preventDefault();
  const i = +h.dataset.i;
  const ws = [...weightsOf(row)];
  const a = childEl(row.id, row.children[i].id).getBoundingClientRect();
  const b = childEl(row.id, row.children[i + 1].id).getBoundingClientRect();
  const pairPx = a.width + b.width, pairW = ws[i] + ws[i + 1], gap = b.left - a.right;
  h.setPointerCapture(e.pointerId);
  h.classList.add('active');
  S.hover = null;
  const move = (ev) => {
    const aw = Math.min(pairPx * 0.95, Math.max(pairPx * 0.05, ev.clientX - a.left - gap / 2));
    ws[i] = (pairW * aw) / pairPx;
    ws[i + 1] = pairW - ws[i];
    previewWeights(row, ws);
    syncSliders(row);
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    h.classList.remove('active');
    if (preview) commitWeights(row, ws);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up, { once: true });
});

// Heights: a block in a column is as tall as its content; it can be made taller (min height),
// never shorter. A handle on each block's bottom edge sets it; double-click goes back to auto.

/** The column the selection sizes: the selected column itself, else the nearest column around it. */
function sizingColumn(id) {
  const n = info(id)?.node;
  if (n?.kind === 'container' && n.arrangement === 'column') return n;
  for (let p = info(id)?.parent; p; p = info(p.id)?.parent) if (p.arrangement === 'column') return p;
  return null;
}
let hPreview = null; // { id, px } while dragging a height

function previewHeight(id, px) {
  hPreview = { id, px };
  const el = elOf(id);
  if (el) {
    el.style.minHeight = px === null ? '' : `${px}px`;
    // like the renderer: start from the content, so a min height never squeezes it
    const item = el.parentElement?.matches('[data-slot]') ? el.parentElement : el;
    if (info(id)?.parent?.arrangement === 'column' && info(id).parent.id !== S.tree.id) Object.assign(item.style, { flexBasis: 'auto', flexShrink: '0' });
  }
  redraw();
}
async function commitHeight(id, px) {
  await op({ op: 'height', id, px }, () => (px === null ? t('{id}: height follows its content', { id }) : t('{id}: at least {px} px tall', { id, px: Math.round(px) })));
  hPreview = null;
}

const hHandlesEl = layer.querySelector('.hhandles');
function drawHeightHandles() {
  const col = S.on && S.sel && !S.taskMode ? sizingColumn(S.sel) : null;
  const kids = col ? col.children : [];
  while (hHandlesEl.children.length > kids.length) hHandlesEl.lastChild.remove();
  while (hHandlesEl.children.length < kids.length) hHandlesEl.insertAdjacentHTML('beforeend', `<div class="hhandle" title="${t('Drag to make it taller · double-click: height follows the content')}"><i></i><span></span></div>`);
  kids.forEach((c, i) => {
    const h = hHandlesEl.children[i];
    const r = elOf(c.id)?.getBoundingClientRect();
    if (!r || !r.height) return (h.style.display = 'none');
    Object.assign(h.style, { display: 'block', left: `${r.left + scrollX}px`, width: `${r.width}px`, top: `${r.bottom + scrollY - 7}px` });
    h.dataset.id = c.id;
    const minH = hPreview?.id === c.id ? hPreview.px : c.minH;
    h.querySelector('span').textContent = minH == null ? t('{id}: {px} px (auto)', { id: c.id, px: Math.round(r.height) }) : t('{id}: {px} px', { id: c.id, px: Math.round(r.height) });
  });
}

hHandlesEl.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.hhandle');
  if (!h || e.button !== 0) return;
  e.preventDefault();
  const id = h.dataset.id;
  const top = elOf(id).getBoundingClientRect().top;
  h.setPointerCapture(e.pointerId);
  h.classList.add('active');
  S.hover = null;
  let px = null;
  const move = (ev) => {
    px = Math.max(0, Math.round(ev.clientY - top));
    previewHeight(id, px);
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    h.classList.remove('active');
    if (px !== null) commitHeight(id, px);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up, { once: true });
});
hHandlesEl.addEventListener('dblclick', (e) => {
  const h = e.target.closest('.hhandle');
  if (h) commitHeight(h.dataset.id, null);
});

// ---------- width: a block narrower than the space it has, centred (its maxw) ----------
// In a row the blocks share the width (the handles between them); anywhere else a block takes the
// whole width, and this handle on its right edge makes it narrower. It's the block's maxw in the
// tree, so no code changes: an Image box shrinks its picture this way.

/** The selected block when it can be made narrower: not the page itself, and not inside a row. */
function widthBlock(id = S.sel) {
  const p = id && id !== S.tree?.id ? info(id)?.parent : null;
  return p && p.arrangement !== 'row' ? id : null;
}
/** The width a block has room for: its slot in the parent. */
const roomOf = (id) => elOf(id)?.parentElement?.getBoundingClientRect() ?? null;

let wPreview = null; // { id, px } while dragging a width
function previewWidth(id, px) {
  wPreview = { id, px };
  const el = elOf(id);
  if (el) Object.assign(el.style, px === null ? { maxWidth: 'none' } : { maxWidth: `${px}px`, marginInline: 'auto', width: '100%' });
  redraw();
}
async function commitWidth(id, px) {
  await op({ op: 'width', id, px }, () => (px === null ? t('{id}: full width', { id }) : t('{id}: at most {px} px wide, centred', { id, px: Math.round(px) })));
  wPreview = null;
}

const wHandle = layer.querySelector('.whandle');
function drawWidthHandle() {
  const id = S.on && !S.taskMode ? widthBlock() : null;
  const r = id && elOf(id)?.getBoundingClientRect();
  if (!r || !r.width) return (wHandle.style.display = 'none');
  // on a full-width block the right edge is the window's: keep the whole handle inside it
  const x = Math.min(r.right - 7, document.documentElement.clientWidth - 14);
  Object.assign(wHandle.style, { display: 'block', left: `${x + scrollX}px`, top: `${r.top + scrollY}px`, height: `${r.height}px` });
  wHandle.dataset.id = id;
  const maxW = wPreview?.id === id ? wPreview.px : info(id).node.maxW;
  wHandle.querySelector('span').textContent = maxW == null ? t('{id}: full width ({px} px)', { id, px: Math.round(r.width) }) : t('{id}: {px} px wide', { id, px: Math.round(r.width) });
}

/** The width for a pointer position: the block stays centred, so its right edge follows the pointer. */
function widthAt(id, clientX) {
  const room = roomOf(id);
  const px = Math.round(2 * (clientX - (room.left + room.width / 2)));
  return px >= room.width - 4 ? null : Math.max(80, px);
}

wHandle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const id = wHandle.dataset.id;
  wHandle.setPointerCapture(e.pointerId);
  wHandle.classList.add('active');
  S.hover = null;
  let px;
  const move = (ev) => previewWidth(id, (px = widthAt(id, ev.clientX)));
  const up = () => {
    wHandle.removeEventListener('pointermove', move);
    wHandle.classList.remove('active');
    if (px !== undefined) commitWidth(id, px);
  };
  wHandle.addEventListener('pointermove', move);
  wHandle.addEventListener('pointerup', up, { once: true });
});
wHandle.addEventListener('dblclick', () => commitWidth(wHandle.dataset.id, null));

// ---------- tree data ----------

function index(tree) {
  S.nodes.clear();
  const rec = (n, parent, depth) => {
    S.nodes.set(n.id, { node: n, parent, depth });
    n.children?.forEach((c) => rec(c, n, depth + 1));
  };
  rec(tree, null, 0);
}

const ancestors = (id) => {
  const out = [];
  for (let p = info(id)?.parent; p; p = info(p.id)?.parent) out.unshift(p.id);
  return out;
};

const ARRANGED = {
  row: (n) => t('Row of {n}, side by side', { n }),
  column: (n) => t('Column of {n}, stacked', { n }),
  periphery: (n) => t('Periphery of {n}, around a centre', { n }),
  wheel: (n) => t('Wheel of {n}, pinwheel', { n }),
};
const kindLabel = (n) =>
  (n.kind === 'box' ? t('Box') : (ARRANGED[n.arrangement] ?? ARRANGED.column)(n.children.length)) + (n.boxType ? ` · ${n.boxType}` : '');
const iconOf = (n) => (n.kind === 'box' ? ICON.box : ICON[n.arrangement] ?? ICON.column);

// ---------- selection ----------

function select(id, { scroll = false, tab } = {}) {
  if (!info(id)) return;
  S.sel = id;
  for (const a of ancestors(id)) S.open.add(a);
  if (tab) per(id).tab = tab;
  renderPath();
  renderTree();
  renderWork();
  redraw();
  if (scroll) {
    const el = elOf(id);
    const r = el?.getBoundingClientRect();
    if (r && (r.bottom < 0 || r.top > innerHeight)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

const parentOf = (id) => info(id)?.parent?.id ?? null;

// ---------- header: path ----------

function renderPath() {
  const ids = S.sel ? [...ancestors(S.sel), S.sel] : [];
  $('.path').innerHTML = ids
    .map((id, i) => `<button data-id="${esc(id)}" ${i === ids.length - 1 ? 'aria-current="true"' : ''}>${esc(id)}</button>`)
    .join('<span class="sep">/</span>');
  $('.path').scrollLeft = $('.path').scrollWidth;
}
$('.path').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) select(b.dataset.id, { scroll: true });
});

// ---------- sidebar: tree ----------

/** Scroll a list so an item is visible, without ever scrolling the page behind the panel. */
function scrollWithin(box, el) {
  if (!el) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
}

function renderTree() {
  const row = (n, depth) => {
    const open = S.open.has(n.id);
    const kids = n.kind === 'container' && open ? n.children.map((c) => row(c, depth + 1)).join('') : '';
    return `<div class="item${n.id === S.sel ? ' sel' : ''}" data-id="${esc(n.id)}" style="--depth:${depth}" title="${esc(kindLabel(n))}">
      ${n.kind === 'container' ? `<button class="twist${open ? ' open' : ''}" aria-label="${open ? t('collapse') : t('expand')}">${ICON.chevron}</button>` : '<span class="twist"></span>'}
      <span class="icon ${n.kind}">${iconOf(n)}</span><span class="name">${esc(n.id)}</span>${n.shared ? `<span class="chip shared" title="${t('Shows the shared block {name}', { name: esc(n.shared) })}">${t('shared')}</span>` : ''}${n.id === S.ai?.id ? `<span class="at-work" title="${t('Kaity is working here')}">${kaityMark(true)}</span>` : ''}
    </div>${kids}`;
  };
  const list = $('.tree');
  list.innerHTML = `<div class="tree-tools"><button data-all="open">${t('Expand all')}</button><button data-all="close">${t('Collapse all')}</button></div>${S.tree ? row(S.tree, 0) : ''}`;
  scrollWithin(list, list.querySelector('.item.sel'));
}

$('.tree').addEventListener('click', (e) => {
  const all = e.target.closest('[data-all]');
  if (all) {
    if (all.dataset.all === 'open') for (const [id, i] of S.nodes) i.node.kind === 'container' && S.open.add(id);
    else S.open.clear();
    store.set('open', [...S.open]);
    return renderTree();
  }
  const item = e.target.closest('.item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.closest('.twist') && info(id).node.kind === 'container') {
    S.open.has(id) ? S.open.delete(id) : S.open.add(id);
    store.set('open', [...S.open]);
    return renderTree();
  }
  select(id, { scroll: true });
});
$('.tree').addEventListener('pointerover', (e) => {
  const item = e.target.closest('.item');
  S.hover = item?.dataset.id ?? null;
  redraw();
});
$('.tree').addEventListener('pointerleave', () => {
  S.hover = null;
  redraw();
});

// ---------- work area ----------

const BOX_TABS = [['text', () => t('Text')], ['code', () => t('Code')], ['size', () => t('Size & look')], ['ai', () => t('Kaity')]];
const CONTAINER_TABS = [['blocks', () => t('Blocks')], ['size', () => t('Size & look')], ['ai', () => t('Kaity')]];
const ROOT_TABS = [['blocks', () => t('Blocks')], ['page', () => t('Page')], ['size', () => t('Size & look')], ['ai', () => t('Kaity')]];

function renderWork() {
  const w = $('.work');
  if (!S.sel || !info(S.sel)) return (w.innerHTML = `<p class="empty">${t('Select a block in the page or in the tree.')}</p>`);
  const id = S.sel;
  const n = info(id).node;
  const p = per(id);
  const tabs = n.kind === 'box' ? BOX_TABS : id === S.tree.id ? ROOT_TABS : CONTAINER_TABS;
  if (!tabs.some(([k]) => k === p.tab)) p.tab = tabs[0][0];
  const parent = info(id).parent;
  const pos = parent ? parent.children.findIndex((c) => c.id === id) : -1;
  const isRoot = !parent;

  const lineUp = n.kind === 'container' && /row|column/.test(n.arrangement);
  const inRow = parent?.arrangement === 'row';
  const actions = [
    // the page has nothing beside or below it: boxes are added inside it
    !isRoot ? `<button data-act="insert" data-as="row" title="${t('New empty box to the right')}">${ic('beside')}${t('Add beside')}</button>` : '',
    !isRoot ? `<button data-act="insert" data-as="column" title="${t('New empty box below')}">${ic('below')}${t('Add below')}</button>` : '',
    lineUp ? `<button data-act="add-inside" title="${n.arrangement === 'row' ? t('New empty box at the end of this row') : t('New empty box at the end of this column')}">${ic('inside')}${t('Add inside')}</button>` : '',
    lineUp ? `<button data-act="flip" title="${n.arrangement === 'row' ? t('Lay the blocks out as a column') : t('Lay the blocks out as a row')}">${ic('flip')}${n.arrangement === 'row' ? t('Make column') : t('Make row')}</button>` : '',
    parent ? `<button data-act="earlier" ${pos <= 0 ? 'disabled' : ''} title="${inRow ? t('Move one place left') : t('Move one place up')}">${ic(inRow ? 'left' : 'up')}${inRow ? t('Left') : t('Up')}</button>` : '',
    parent ? `<button data-act="later" ${pos >= parent.children.length - 1 ? 'disabled' : ''} title="${inRow ? t('Move one place right') : t('Move one place down')}">${ic(inRow ? 'right' : 'down')}${inRow ? t('Right') : t('Down')}</button>` : '',
    n.kind === 'container' && !isRoot ? `<button data-act="ungroup" title="${t('Remove the container, keep its blocks')}">${ic('ungroup')}${t('Ungroup')}</button>` : '',
    `<button data-act="rename" title="${t('Give this block a name people and Kaity can refer to')}">${ic('rename')}${t('Rename')}</button>`,
    S.buffer.length ? `<button data-act="paste" title="${t('Paste code from the buffer')}">${ic('paste')}${t('Paste…')}</button>` : '',
    n.kind === 'box' && S.kit.site && !n.shared ? `<button data-act="share" title="${t('Make this box a shared block: every page of the site can show it, and a change to it changes them all')}">${ic('site')}${t('Share…')}</button>` : '',
    !isRoot ? `<button data-act="remove" class="danger" title="${t('Delete (code goes into the previous box) or remove (code goes to the buffer)')}">${ic('delete')}${t('Delete…')}</button>` : '',
  ].join('');
  const users = n.shared ? S.kit.users[n.shared] ?? [] : [];
  const sharedNote = n.shared ? `<p class="shared-note">${ic('site')}<span>${users.length > 1
    ? t('This box shows the shared block {name}, which {n} pages show: a change here changes all of them.', { name: `<b>${esc(n.shared)}</b>`, n: users.length })
    : t('This box shows the shared block {name}: a change here changes it on every page that shows it.', { name: `<b>${esc(n.shared)}</b>` })}</span><button data-act="unlink" title="${t('This page gets its own copy of the block, which stops following the shared one')}">${t('Make this page\'s own copy')}</button></p>` : '';

  w.innerHTML = `
    <div class="w-head">
      <input class="w-name" value="${esc(id)}" spellcheck="false" aria-label="${t('name')}" title="${t('Rename (Enter)')}">
      <span class="w-kind">${esc(kindLabel(n))}</span>
    </div>
    <div class="actions">${actions}</div>
    ${sharedNote}
    <div class="sheet" hidden></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${p.tab === k}">${k === 'ai' ? kaityMark(S.ai?.id === id) : ic(TAB_ICON[k])}${l()}</button>`).join('')}</div>
    <div class="tab-body"></div>`;
  renderSheet();
  renderTab();
}

function renderTab() {
  const id = S.sel;
  const p = per(id);
  const body = $('.work .tab-body');
  if (!body) return;
  body.dataset.pane = p.tab;
  body.onclick = body.oninput = body.onchange = body.onkeydown = body.onpointerover = null;
  if (p.tab === 'text') return renderText(body, id);
  if (p.tab === 'code') return renderCode(body, id);
  if (p.tab === 'ai') return renderAI(body, id);
  if (p.tab === 'blocks') return renderBlocks(body, id);
  if (p.tab === 'size') return renderSize(body, id);
  if (p.tab === 'page') return renderPage(body);
}

$('.work').addEventListener('click', async (e) => {
  const tab = e.target.closest('.tabs [data-tab]');
  if (tab) {
    per(S.sel).tab = tab.dataset.tab;
    for (const b of $('.work .tabs').children) b.setAttribute('aria-selected', b === tab);
    return renderTab();
  }
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act, S.sel, b.dataset);
});

$('.work').addEventListener('keydown', (e) => {
  if (e.target.classList.contains('w-name')) {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') {
      e.target.value = S.sel;
      e.target.blur();
    }
  }
});
$('.work').addEventListener('focusout', async (e) => {
  if (!e.target.classList?.contains('w-name')) return;
  const name = e.target.value.trim();
  if (!name || name === S.sel) return (e.target.value = S.sel);
  const old = S.sel;
  if (!(await renameBlock(old, name))) e.target.value = old;
});

/** Rename a block; its panel state (tab, drafts) goes with it. Returns whether it worked. */
async function renameBlock(old, name) {
  try {
    await api('/op', { op: 'rename', id: old, name });
    S.per.set(name, S.per.get(old) ?? {});
    if (S.sel === old) S.sel = name;
    toast(t('Renamed to {name}', { name }));
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function op(body, msg) {
  try {
    const r = await api('/op', body);
    if (msg) toast(msg(r.result));
    return r.result;
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

async function act(what, id, data = {}) {
  showPanel();
  switch (what) {
    case 'insert': {
      const name = await op({ op: 'insert', id, as: data.as }, (name) => t('Added {name}', { name }));
      if (name) pendingSelect = name;
      return;
    }
    case 'add-inside': {
      const name = await op({ op: 'add', id, where: 'inside' }, (name) => t('Added {name}', { name }));
      if (name) pendingSelect = name;
      return;
    }
    case 'flip': return op({ op: 'flip', id });
    case 'earlier': return op({ op: 'reorder', id, by: -1 });
    case 'later': return op({ op: 'reorder', id, by: 1 });
    case 'ungroup': {
      pendingSelect = parentOf(id);
      return op({ op: 'ungroup', id }, () => t('{id} ungrouped', { id }));
    }
    case 'rename': {
      if (S.sel !== id) select(id);
      const input = $('.work .w-name');
      input.focus();
      input.select();
      return;
    }
    case 'remove':
    case 'paste':
    case 'import':
      if (S.sel !== id) select(id);
      per(id).sheet = what;
      return renderSheet();
    case 'import-again':
      per(id).imp = { url: per(id).imp?.url ?? '', busy: false, sections: null, token: null, error: null };
      return renderSheet();
    case 'sheet-close':
      per(id).sheet = null;
      return renderSheet();
    case 'delete-do': {
      per(id).sheet = null;
      const to = await op({ op: 'delete', id }, (to) => (to ? t('Deleted {id}; its code is now at the end of {to}. Undo brings it back.', { id, to }) : t('Deleted {id}. Undo brings it back.', { id })));
      pendingSelect = to || parentOf(id);
      return;
    }
    case 'remove-do': {
      per(id).sheet = null;
      pendingSelect = parentOf(id);
      return op({ op: 'remove', id }, () => t('Removed {id}; its code is in the buffer, ready to paste.', { id }));
    }
    case 'paste-do': {
      per(id).sheet = null;
      const name = await op({ op: 'paste', i: +data.i, id, how: data.how }, (name) => (data.how === 'into' ? t('Pasted into {name}', { name }) : t('Pasted as {name}', { name })));
      if (name) pendingSelect = name;
      return;
    }
    case 'drop': return op({ op: 'drop', i: +data.i });
    case 'import-copy': return copySections(id);
    case 'import-place': {
      const imp = per(id).imp;
      if (!imp?.token) return;
      per(id).sheet = null;
      per(id).imp = null;
      per(id).box = null;
      pendingSelect = id;
      return op({ op: 'section', id, token: imp.token, section: data.section }, () => t('{section} imported into {id}. Undo takes it out again.', { section: data.section, id }));
    }
    case 'share':
      if (S.sel !== id) select(id);
      per(id).sheet = 'share';
      return renderSheet();
    case 'share-do': {
      const name = $('.work .share-name')?.value.trim() || id;
      per(id).sheet = null;
      const r = await op({ op: 'share', id, name }, (b) => t('{id} is now the shared block {b}. Other pages show it with Use a shared block…', { id, b }));
      if (r) loadKit();
      return;
    }
    case 'link-do':
      per(id).sheet = null;
      await op({ op: 'link', id, name: data.name }, () => t('{id} shows the shared block {name}', { id, name: data.name }));
      return loadKit();
    case 'unlink':
      await op({ op: 'unlink', id }, () => t('{id} is this page\'s own copy now; the other pages keep the shared block. Undo links it again.', { id }));
      return loadKit();
    case 'size': return select(id, { tab: 'size' });
    case 'parent': return parentOf(id) && select(parentOf(id), { scroll: true });
    case 'tab': return select(id, { tab: data.tab });
  }
}

/** The sheet under the actions: removal choices, or the buffer to paste from. */
async function renderSheet() {
  const id = S.sel;
  const c = $('.work .sheet');
  if (!c) return;
  const mode = per(id).sheet;
  if (!mode) return (c.hidden = true, c.innerHTML = '');
  c.hidden = false;
  const n = info(id).node;
  const cancel = `<button data-act="sheet-close">${t('Cancel')}</button>`;
  if (mode === 'import') return renderImport(c, id);
  if (mode === 'share') {
    const free = S.kit.blocks.includes(id) ? '' : id;
    c.innerHTML = `<p>${t('Share {id} with every page of the site: its code becomes a shared block, which any page can show (Use a shared block…). A change to it then changes every page that shows it.', { id: `<b>${esc(id)}</b>` })}</p>
      <label class="pop-field"><span>${t('Name of the shared block')}</span><input class="share-name" value="${esc(free)}" spellcheck="false" placeholder="${t('e.g. nav')}"></label>
      ${S.kit.blocks.length ? `<p class="muted">${t('Or show one the site already has:')} ${S.kit.blocks.map((b) => `<button class="link" data-act="link-do" data-name="${esc(b)}">${esc(b)}</button>`).join(' ')}</p>` : ''}
      <div class="row">${cancel}<button class="primary" data-act="share-do">${t('Share')}</button></div>`;
    return;
  }
  if (mode === 'paste') {
    const hows = n.kind === 'box'
      ? [['into', t('Into this box')], ['beside', t('New box beside')], ['below', t('New box below')]]
      : [...(/row|column/.test(n.arrangement) ? [['inside', t('New box inside')]] : []), ['beside', t('New box beside')], ['below', t('New box below')]];
    c.innerHTML = `<p>${n.kind === 'box' ? t('Paste from the buffer:') : t('Paste from the buffer into {id}:', { id: `<b>${esc(id)}</b>` })}</p>
      <ul class="buffer">${S.buffer.map((b) => `<li>
        <div class="buf-head"><b>${esc(b.from)}</b><span class="muted">${b.boxes > 1 ? `${t('{n} boxes', { n: b.boxes })} · ` : ''}${new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button class="link" data-act="drop" data-i="${b.i}" title="${t('Forget this item')}">${t('forget')}</button></div>
        <div class="buf-preview">${esc(b.preview || t('(no text)'))}</div>
        <div class="row">${hows.map(([h, l]) => `<button data-act="paste-do" data-i="${b.i}" data-how="${h}">${l}</button>`).join('')}</div></li>`).join('')}</ul>
      <div class="row">${cancel}</div>`;
    return;
  }
  c.innerHTML = `<p class="muted">${t('Looking at the code…')}</p>`;
  const html = await removalChoices(id);
  if (S.sel !== id || per(id).sheet !== 'remove') return;
  c.innerHTML = html;
}

// ---------- Import a section: a part of another web page in place of a box ----------
// The server copies the page with the importer (a browser opens it, so it takes a while), lists its
// sections with a picture of each, and keeps the copy until the next one; the chosen section then
// replaces the box (one undo step). The copying advice is shown before anything is copied.

function renderImport(c, id) {
  const imp = (per(id).imp ??= { url: '', busy: false, sections: null, token: null, error: null });
  const cancel = `<button data-act="sheet-close">${t('Cancel')}</button>`;
  const hasCode = info(id)?.node.hasCode;
  if (imp.sections) {
    c.innerHTML = `<p>${t('Choose the section of {url} that replaces {id}.', { url: `<b>${esc(new URL(imp.url).host)}</b>`, id: `<b>${esc(id)}</b>` })}${hasCode ? ` ${t('Its code is replaced too; undo brings it back.')}` : ''}</p>
      ${imp.sections.length ? `<ul class="sections">${imp.sections.map((x) => `<li><button data-act="import-place" data-section="${esc(x.id)}" title="${t('Use this section')}">
        ${x.shot ? `<img src="${esc(x.shot)}" alt="" loading="lazy">` : `<span class="noshot">${t('(no picture)')}</span>`}
        <span class="sec-name"><b>${esc(x.id)}</b><span class="muted">${x.width}×${x.height}</span></span></button></li>`).join('')}</ul>` : `<p class="muted">${t('TYKERF found no sections on that page.')}</p>`}
      <div class="row"><button data-act="import-again">${t('Another page')}</button>${cancel}</div>`;
    return;
  }
  c.innerHTML = `<p>${t('Copy a section of another web page into {id}.', { id: `<b>${esc(id)}</b>` })}</p>
    <label class="field"><span>${t('Web address')}</span><input class="imp-url" type="url" placeholder="https://example.com" spellcheck="false" value="${esc(imp.url)}" ${imp.busy ? 'disabled' : ''}></label>
    <p class="hint">${t('A copy includes the site\'s text, images and design, which usually belong to someone else. Copy from your own site freely; from someone else\'s only to study or prototype, and publish it only with the owner\'s permission.')}</p>
    ${imp.error ? `<p class="error" role="alert">${esc(imp.error)}</p>` : ''}
    <div class="row">${imp.busy ? `<span class="muted" role="status">${t('Copying the page… This usually takes under a minute.')}</span>` : `<button data-act="import-copy" class="primary">${ic('import')}${t('Copy the page')}</button>${cancel}`}</div>`;
  const input = $('.imp-url', c);
  input.oninput = () => (imp.url = input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') e.preventDefault(), copySections(id);
  };
  if (!imp.busy) input.focus();
}

async function copySections(id) {
  const imp = per(id).imp;
  if (!imp || imp.busy) return;
  imp.url = imp.url.trim();
  if (!/^https?:\/\/\S+$/i.test(imp.url)) {
    imp.error = t('Write the address of the page to copy, starting with https://');
    return renderSheet();
  }
  Object.assign(imp, { busy: true, error: null });
  renderSheet();
  try {
    const r = await api('/import', { url: imp.url });
    Object.assign(imp, { url: r.url, sections: r.sections, token: r.token });
  } catch (err) {
    imp.error = err.message;
  }
  imp.busy = false;
  if (S.sel === id && per(id).sheet === 'import') renderSheet();
}

/** What taking out a block does to its code, as choices (the panel's sheet and the page's popover share it). */
async function removalChoices(id) {
  const n = info(id).node;
  const cancel = `<button data-act="sheet-close">${t('Cancel')}</button>`;
  const info2 = await api(`/box?id=${encodeURIComponent(id)}`).catch(() => ({ previous: null, boxesWithCode: 0 }));
  const bid = `<b>${esc(id)}</b>`;
  if (!info2.boxesWithCode) {
    return `<p>${n.kind === 'box' ? t('Take out the box {id}? It has no code.', { id: bid }) : t('Take out {id} and everything inside it? It has no code.', { id: bid })}</p><div class="row"><button data-act="remove-do" class="danger">${t('Delete')}</button>${cancel}</div>`;
  }
  const question = n.kind === 'box'
    ? t('Take out the box {id}. What happens to its code?', { id: bid })
    : info2.boxesWithCode > 1
      ? t('Take out {id} and everything inside it. What happens to the code of its {n} boxes?', { id: bid, n: info2.boxesWithCode })
      : t('Take out {id} and everything inside it. What happens to its code?', { id: bid });
  return `<p>${question}</p>
    <div class="choices">
      ${info2.previous ? `<button data-act="delete-do" class="choice"><b>${t('Delete')}</b><span>${t('The code jumps to the end of {box}, the box before it.', { box: `<b>${esc(info2.previous)}</b>` })}</span></button>` : ''}
      <button data-act="remove-do" class="choice"><b>${t('Remove')}</b><span>${t('The code goes to the buffer and leaves the page. Paste it anywhere later.')}</span></button>
    </div>
    <div class="row">${cancel}<span class="hint">${t('Undo reverts either one.')}</span></div>`;
}

// ---------- Text tab: edit the words of a box without touching its markup ----------

const TEXT_SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** The editable parts of a box: its text nodes plus link targets and image sources/alt texts. */
function textFields(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const fields = [];
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3 && c.nodeValue.trim()) {
        const tag = c.parentNode.nodeName === '#document-fragment' ? 'text' : c.parentNode.nodeName.toLowerCase();
        fields.push({ label: tag, value: c.nodeValue.trim(), set: (v) => { const m = c.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/); c.nodeValue = m[1] + v + m[2]; } });
      } else if (c.nodeType === 1 && !TEXT_SKIP.has(c.nodeName)) {
        if (c.nodeName === 'IMG') {
          fields.push({ label: t('image'), value: c.getAttribute('src') ?? '', attr: true, set: (v) => c.setAttribute('src', v) });
          fields.push({ label: t('image text'), value: c.getAttribute('alt') ?? '', attr: true, set: (v) => c.setAttribute('alt', v) });
        }
        walk(c);
        if (c.nodeName === 'A' && c.hasAttribute('href')) fields.push({ label: t('link to'), value: c.getAttribute('href'), attr: true, link: true, set: (v) => c.setAttribute('href', v) });
      }
    }
  };
  walk(tpl.content);
  return { fields, serialize: () => tpl.innerHTML };
}

async function loadBox(id, force = false) {
  const p = per(id);
  if (!p.box || force) p.box = await api(`/box?id=${encodeURIComponent(id)}`);
  return p.box;
}

async function renderText(body, id) {
  body.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
  const box = await loadBox(id);
  if (S.sel !== id || per(id).tab !== 'text') return;
  const p = per(id);
  const parsed = textFields(box.html);
  if (!parsed.fields.length) {
    body.innerHTML = `<p class="muted">${box.html ? t('This box has no text to edit. Use Code, or ask Kaity.') : t('This box is empty. Write its code, or ask Kaity to fill it.')}</p>
      <div class="row">${box.html ? '' : `<button data-pick-component>${ic('component')}${t('Use a component')}</button><button data-act="import">${ic('import')}${t('Import a section')}</button>`}<button data-goto="code">${t('Write code')}</button><button data-goto="ai">${t('Ask Kaity')}</button></div>`;
    body.onclick = (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) act('tab', id, { tab: g.dataset.goto });
      if (e.target.closest('[data-pick-component]')) renderComponents(body, id);
    };
    return;
  }
  p.text ??= parsed.fields.map((f) => f.value);
  body.innerHTML = `<div class="fields">${parsed.fields.map((f, i) => `
      <label class="field${f.attr ? ' attr' : ''}"><span>${esc(f.label)}</span>
      <textarea rows="1" data-i="${i}" spellcheck="${!f.attr}">${esc(p.text[i] ?? f.value)}</textarea>${f.link && S.site?.pages.length ? `
      <select data-link="${i}" aria-label="${t('Link to a page of this site')}"><option value="">${t('Link to a page…')}</option>${S.site.pages.map((pg) => `<option value="${esc(pageHref(pg))}">${esc(pg)}</option>`).join('')}</select>` : ''}</label>`).join('')}</div>
    <div class="savebar"><span class="status"></span><button data-text="revert">${t('Revert')}</button><button data-text="save" class="primary">${t('Save text')}</button></div>`;
  const status = $('.status', body);
  const dirty = () => parsed.fields.some((f, i) => (p.text[i] ?? f.value) !== f.value);
  const mark = () => (status.textContent = dirty() ? t('Unsaved changes') : '');
  for (const ta of body.querySelectorAll('textarea')) autosize(ta);
  mark();
  if (p.focusText) {
    const want = p.focusText;
    p.focusText = null;
    const ta = [...body.querySelectorAll('textarea')].find((x) => x.value.trim() && want.includes(x.value.trim()));
    ta?.focus();
    ta?.scrollIntoView({ block: 'nearest' });
  }
  body.onchange = (e) => {
    const sel = e.target.closest('select[data-link]');
    if (!sel?.value) return;
    const ta = $(`textarea[data-i="${sel.dataset.link}"]`, body);
    ta.value = sel.value;
    sel.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  body.oninput = (e) => {
    const ta = e.target.closest('textarea[data-i]');
    if (!ta) return;
    p.text[+ta.dataset.i] = ta.value;
    autosize(ta);
    mark();
  };
  body.onclick = async (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) return act('tab', id, { tab: g.dataset.goto });
    const a = e.target.closest('[data-text]')?.dataset.text;
    if (a === 'revert') {
      p.text = null;
      return renderText(body, id);
    }
    if (a === 'save') saveText(id, parsed);
  };
  body.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveText(id, parsed);
    }
  };
}

async function saveText(id, parsed) {
  const p = per(id);
  parsed.fields.forEach((f, i) => f.set(p.text[i] ?? f.value));
  try {
    await api('/box', { id, html: parsed.serialize() });
    p.text = null;
    p.box = null;
    toast(t('Text saved'));
  } catch (err) {
    toast(err.message, true);
  }
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight + 2, 240)}px`;
}

// ---------- components: ready-made boxes with placeholders ----------

let library = null; // { components, layouts } from the server, loaded once
const loadLibrary = async () => (library ??= await api('/components'));

async function renderComponents(body, id) {
  body.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
  const { components } = await loadLibrary();
  if (S.sel !== id) return;
  body.innerHTML = `<p class="hint">${t('Pick a component for {id}. Its text and images are placeholders: replace them in the Text tab, or ask Kaity.', { id: `<b>${esc(id)}</b>` })}</p>
    <div class="components">${components.map((c) => `<button data-component="${esc(c.name)}"><b>${esc(t(c.label))}</b><span>${esc(t(c.description))}</span></button>`).join('')}</div>
    <div class="row"><button data-back>${t('Cancel')}</button></div>`;
  body.onclick = async (e) => {
    if (e.target.closest('[data-back]')) return renderText(body, id);
    const c = e.target.closest('[data-component]');
    if (!c) return;
    const label = components.find((x) => x.name === c.dataset.component)?.label ?? c.dataset.component;
    pendingSelect = id;
    await op({ op: 'component', id, name: c.dataset.component }, () => t('{component} added to {id}', { component: t(label), id }));
  };
}

// ---------- Page tab (the top block): theme and page-wide head code ----------

const THEME_LABELS = {
  '--color-bg': () => t('Background'), '--color-band': () => t('Alternate bands'), '--color-surface': () => t('Cards'), '--color-text': () => t('Text'),
  '--color-muted': () => t('Secondary text'), '--color-border': () => t('Lines'), '--color-accent': () => t('Accent'),
  '--color-on-accent': () => t('Text on the accent'), '--color-soft': () => t('Soft accent'), '--color-dark': () => t('Dark band'),
  '--color-on-dark': () => t('Text on the dark band'), '--font-body': () => t('Body font'), '--font-heading': () => t('Heading font'),
  '--font-accent': () => t('Accent font'), '--weight-heading': () => t('Heading weight'), '--tracking-heading': () => t('Heading letter spacing'),
  '--text-hero': () => t('Hero size'), '--text-title': () => t('Section title size'), '--text-lead': () => t('Lead text size'), '--text-body': () => t('Body text size'),
  '--radius': () => t('Corner radius'), '--radius-button': () => t('Button radius'), '--gap': () => t('Spacing'),
  '--space-section': () => t('Space between sections'), '--max-width': () => t('Content width'),
};
// fonts bundled with TYKERF (copied into the page) and system fonts: a font from a CDN would send every visitor's IP address to a third party
const FONT_STACKS = ['"Inter", system-ui, sans-serif', '"DM Sans", system-ui, sans-serif', '"Manrope", system-ui, sans-serif', '"Newsreader", Georgia, serif', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', 'Georgia, "Times New Roman", serif', '"Helvetica Neue", Arial, sans-serif', 'ui-monospace, Menlo, Consolas, monospace'];
/** The theme's values in three groups, so the list is easy to scan. */
const THEME_GROUPS = [
  [() => t('Colours'), (n) => n.startsWith('--color')],
  [() => t('Type'), (n) => /^--(font|weight|tracking|text)/.test(n)],
  [() => t('Shape and space'), (n) => !/^--(color|font|weight|tracking|text)/.test(n)],
];
const THEME_BLOCK = /(<style[^>]*\bdata-tykerf-theme\b[^>]*>)([\s\S]*?)(<\/style>)/;
// colours that follow the background unless they get one of their own (as in library/theme.html)
const DERIVED = {
  '--color-band': 'color-mix(in srgb, var(--color-bg) 95%, var(--color-text))',
  '--color-surface': 'color-mix(in srgb, var(--color-bg) 96%, var(--color-text))',
  '--color-border': 'color-mix(in srgb, var(--color-bg) 86%, var(--color-text))',
  '--color-soft': 'color-mix(in srgb, var(--color-accent) 12%, var(--color-bg))',
};

/** The colour a CSS colour value shows on this page (it may use var() and color-mix()), as #rrggbb. */
function resolveColor(value) {
  const probe = document.createElement('i');
  probe.style.color = value;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  const [r, g, b] = c.startsWith('color(') ? n.slice(0, 3).map((x) => x * 255) : n;
  return '#' + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x || 0))).toString(16).padStart(2, '0')).join('');
}

/** The theme variables declared in head.html: [name, value] in order. */
function themeVars(head) {
  const block = THEME_BLOCK.exec(head)?.[2] ?? '';
  const root = /:root\s*\{([^}]*)\}/.exec(block)?.[1] ?? '';
  return [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
}
/** head.html with new values for some theme variables; everything else stays as written. */
function withThemeVars(head, values) {
  // only :root holds the theme's values; the band tones after it reuse the names and stay as they are
  return head.replace(THEME_BLOCK, (_m, open, css, close) =>
    open + css.replace(/:root\s*\{[^}]*\}/, (root) => root.replace(/(--[\w-]+)(\s*:\s*)([^;]+);/g, (d, name, sep) => (name in values ? `${name}${sep}${values[name]};` : d))) + close);
}

async function renderPage(body) {
  body.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
  const [{ html, themeVariables, sharedTheme, ownLook, overrides = {} }, { themes, theme: base }] = await Promise.all([api('/head'), fetch('/_tykerf/library').then((r) => r.json())]);
  // a page of a site that shares one theme: the theme part edits the site's head, or this page's own values over it
  const site = sharedTheme ? await siteApi('/head') : null;
  if (per(S.sel).tab !== 'page') return;
  const p = per(S.sel);
  p.head ??= html;
  const own = Object.keys(overrides);
  // "site": changes go to every page; "page": to this page only (its own values over the site theme)
  const scope = site ? (p.themeScope ??= own.length ? 'page' : 'site') : 'own';
  const siteVars = site ? themeVars(site.html) : [];
  const vars = site ? siteVars.map(([n, v]) => [n, scope === 'page' && n in overrides ? overrides[n] : v]) : themeVars(html);
  const siteValue = Object.fromEntries(siteVars);
  const canShare = S.site && !sharedTheme && !ownLook && vars.length;
  // the preset this theme was made from (remembered on its theme block), and whether values changed since
  const madeFrom = scope === 'page' ? null : themes.find((th) => th.name === /<style[^>]*\bdata-tykerf-theme\b[^>]*\bdata-tykerf-preset="([a-z0-9-]+)"/.exec(site ? site.html : html)?.[1]);
  const current = Object.fromEntries(vars);
  const drifted = madeFrom ? Object.entries(madeFrom.values).some(([n, v]) => n in current && current[n].trim() !== String(v).trim()) : false;
  const label = (n) => THEME_LABELS[n]?.() ?? n;

  // where this page's look comes from, always said first
  const status = ownLook
    ? { cls: 'own', text: t('Own look: this page is a copy of a website, so the site theme does not apply to it. Change it in the head code.') }
    : site && own.length
      ? { cls: 'mixed', text: own.length <= 5
        ? t('Inherited from the site theme, with {n} values of its own: {list}.', { n: own.length, list: own.map((n) => `<b>${esc(label(n))}</b>`).join(', ') })
        : t('Inherited from the site theme, with {n} values of its own: {list} and {more} more.', { n: own.length, list: own.slice(0, 5).map((n) => `<b>${esc(label(n))}</b>`).join(', '), more: own.length - 5 }) }
      : site
        ? { cls: 'inherited', text: t('Inherited: this page uses the site theme, like every page of the site.') }
        : S.site && vars.length
          ? { cls: 'own', text: t('Own theme: this page has a theme of its own and does not follow a site theme.') }
          : null;

  const field = ([name, value]) => {
    const mine = scope === 'page' && name in overrides;
    const origin = scope === 'page'
      ? mine
        ? `<span class="origin mine" title="${t('Set on this page only')}">${t('this page')}</span><button class="link" data-unset="${esc(name)}" title="${t('Use the site value again')}">${t('reset')}</button>`
        : `<span class="origin" title="${t('Inherited from the site theme')}">${t('site')}</span>`
      : '';
    const isHex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value);
    const auto = name.startsWith('--color') && !isHex; // follows other colours (color-mix, var)
    if (isHex || auto) {
      const hex = auto ? resolveColor(value) : value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : value;
      // "auto": the colour follows the others (a formula); a colour that could follow them offers to again
      const tag = auto
        ? `<span class="auto" title="${t('Follows the background. Pick a colour to set your own.')}">${t('auto')}</span>`
        : name in DERIVED && scope !== 'page' ? `<button class="link" data-auto-var="${esc(name)}" title="${t('Follow the background again')}">${t('make auto')}</button>` : '';
      return `<label class="theme-var${mine ? ' mine' : ''}"><span class="name">${esc(label(name))}</span><span class="marks">${origin}${tag}</span><input type="color" value="${esc(hex)}" data-var="${esc(name)}" ${auto ? 'data-auto' : ''}></label>`;
    }
    return `<label class="theme-var${mine ? ' mine' : ''}"><span class="name">${esc(label(name))}</span><span class="marks">${origin}</span><input type="text" value="${esc(value)}" data-var="${esc(name)}" spellcheck="false" ${name.startsWith('--font') ? 'list="tykerf-fonts"' : ''}></label>`;
  };
  const heading = scope === 'site' ? t('Site theme') : scope === 'page' ? t('This page\'s theme') : t('Theme');
  const sub = scope === 'site' ? t('(colours, fonts and spacing for every page of the site)') : scope === 'page' ? t('(values set here apply to this page only; the rest comes from the site theme)') : t('(colours, fonts and spacing for the whole page)');
  body.innerHTML = `
    <a class="handbook-link" href="${API}/handbook" target="_blank" rel="noopener" title="${t('The page\'s theme and every block, with chips to copy into a request, and their tasks')}">${ic('blocks')}<span><b>${t('Handbook')}</b> ${t('the page\'s system on one page')}</span>${ic('right')}</a>
    <section class="size-sec">
      ${status ? `<p class="theme-status ${status.cls}">${status.text}</p>` : ''}
      <p class="size-head">${heading} <span class="muted">${sub}</span></p>
      ${site ? `<div class="theme-scope" role="radiogroup" aria-label="${t('Where theme changes apply')}"><button data-scope="site" aria-pressed="${scope === 'site'}">${t('Every page')}</button><button data-scope="page" aria-pressed="${scope === 'page'}">${t('This page only')}</button></div>` : ''}
      ${vars.length
        ? `<div class="presets" role="group" aria-label="${t('Theme presets')}">${themes.map((th) => `<button data-preset="${esc(th.name)}" aria-pressed="${th === madeFrom}" title="${esc(t(th.description))}"><span class="sw">${['--color-bg', '--color-text', '--color-accent'].map((k) => `<i style="background:${esc(th.values[k] ?? '#fff')}"></i>`).join('')}</span>${esc(t(th.label))}${th === madeFrom && drifted ? ` <span class="changed">· ${t('changed')}</span>` : ''}</button>`).join('')}</div>
           <p class="hint">${scope === 'page' ? t('A preset here gives this page its own colours and fonts; values equal to the site\'s stay inherited.') : t('A preset sets every value below at once (one undo step); then change any of them.')}</p>
           ${THEME_GROUPS.map(([title, test]) => {
             const group = vars.filter(([n]) => test(n));
             return group.length ? `<p class="theme-group">${title()}</p><div class="theme">${group.map(field).join('')}</div>` : '';
           }).join('')}<datalist id="tykerf-fonts">${FONT_STACKS.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
           <div class="row end">${madeFrom && drifted ? `<button data-page="reset-preset" title="${t('Put every value back to the preset (one undo step)')}">${t('Reset to {preset}', { preset: esc(t(madeFrom.label)) })}</button>` : ''}${scope === 'site' && site?.last ? `<button data-page="site-undo" title="${esc(site.last.label)}">${t('Undo the last site theme change')}</button>` : ''}${scope === 'page' && own.length ? `<button data-page="reset-own">${t('Use the site theme again')}</button>` : ''}<button data-page="theme" class="primary">${scope === 'page' ? t('Apply to this page') : t('Apply theme')}</button></div>
           ${canShare ? `<div class="row start"><button data-page="share">${t('Use this theme for every page')}</button></div><p class="hint">${t('The other pages of the site take this theme, and changing it here changes them all. Copies of websites keep their own look.')}</p>` : ''}`
        : ownLook ? '' : `<p class="muted">${t('This page has no theme yet. Components use one; adding it changes nothing else on the page.')}</p>
           <div class="row"><button data-page="add-theme">${t('Add the theme')}</button></div>`}
    </section>
    <section class="size-sec"><p class="size-head">${t('Head code')} <span class="muted">${t('(fonts, styles and scripts for the whole page)')}</span></p>
      <textarea class="code head-code" spellcheck="false" wrap="off">${esc(p.head)}</textarea>
      <div class="savebar"><span class="status"></span><button data-page="revert">${t('Revert')}</button><button data-page="save" class="primary">${t('Save head')}</button></div>
    </section>
    <p class="hint">${t('Saving reloads the page, because the head can only change with a reload. Undo reverts it.')}</p>
    <section class="size-sec unused-files" hidden></section>`;
  // files the page no longer uses (earlier crops, pictures of removed boxes): offered for clean-up only when there are some
  api('/assets/unused').then(({ files, bytes }) => {
    const sec = $('.unused-files', body);
    if (!sec || !files.length) return;
    sec.hidden = false;
    sec.innerHTML = `<p class="size-head">${t('Unused files')}</p>
      <p class="muted">${files.length === 1
        ? t('One file in the assets folder ({kb} KB) is not used by any box, the head, or a step undo can bring back.', { kb: Math.max(1, Math.round(bytes / 1024)) })
        : t('{n} files in the assets folder ({kb} KB) are not used by any box, the head, or a step undo can bring back.', { n: files.length, kb: Math.max(1, Math.round(bytes / 1024)) })}</p>
      <div class="row end"><button data-page="clean-files">${t('Move them to the trash')}</button></div>
      <p class="hint">${t('They go to the .trash folder of the page; nothing is deleted.')}</p>`;
  }, () => {});
  const ta = $('.head-code', body);
  const saved = $('.savebar .status', body);
  const mark = () => (saved.textContent = p.head !== html ? t('Unsaved changes') : '');
  mark();
  ta.oninput = () => {
    p.head = ta.value;
    mark();
  };
  const save = async (next) => {
    try {
      await api('/head', { html: next });
      p.head = null;
      toast(t('Page head saved'));
    } catch (err) {
      toast(err.message, true);
    }
  };
  // this page's own values: only those that differ from the site's are kept
  const saveOwn = async (values) => {
    const diff = Object.fromEntries(Object.entries(values).filter(([n, v]) => n in siteValue && v.trim() !== siteValue[n].trim()));
    try {
      await api('/head/override', { values: diff });
      p.head = null;
      toast(Object.keys(diff).length ? t('Saved for this page only') : t('This page follows the site theme again'));
    } catch (err) {
      toast(err.message, true);
    }
  };
  // a preset is TYKERF's current theme with the preset's values: the whole theme block is rebuilt, so an older
  // head gets the variables it lacks and band rules damaged by older editors are repaired
  const withPreset = (head, values, name) => {
    const block = withThemeVars(THEME_BLOCK.exec(base)?.[0] ?? '', values).replace(/<style([^>]*\bdata-tykerf-theme\b[^>]*)>/, (_m, attrs) => `<style${attrs.replace(/\s*data-tykerf-preset="[^"]*"/, '')}${name ? ` data-tykerf-preset="${name}"` : ''}>`);
    return THEME_BLOCK.test(head) ? head.replace(THEME_BLOCK, block) : `${block}\n${head}`;
  };
  const savePreset = async (values, name) => {
    if (scope === 'page') return saveOwn(values);
    if (!site) return save(withPreset(html, values, name));
    try {
      await siteApi('/head', { html: withPreset(site.html, values, name) });
      toast(t('Site theme saved: every page uses it'));
    } catch (err) {
      toast(err.message, true);
    }
  };
  // theme values: the site's head, this page's own values, or (outside a shared site) the page's own theme
  const saveTheme = async (values) => {
    if (scope === 'page') return saveOwn({ ...overrides, ...values });
    if (!site) return save(withThemeVars(html, values));
    try {
      await siteApi('/head', { html: withThemeVars(site.html, values) });
      toast(t('Site theme saved: every page uses it'));
    } catch (err) {
      toast(err.message, true);
    }
  };
  // picking a colour for an automatic one makes it the user's own
  body.oninput = (e) => e.target.matches?.('[data-auto]') && (e.target.removeAttribute('data-auto'), e.target.parentElement.querySelector('.auto')?.remove());
  body.onclick = (e) => {
    const sc = e.target.closest('[data-scope]')?.dataset.scope;
    if (sc) return (p.themeScope = sc), renderPage(body);
    const unset = e.target.closest('[data-unset]')?.dataset.unset;
    if (unset) {
      e.preventDefault();
      const rest = { ...overrides };
      delete rest[unset];
      return saveOwn(rest);
    }
    const back = e.target.closest('[data-auto-var]');
    if (back) {
      e.preventDefault();
      return saveTheme({ [back.dataset.autoVar]: DERIVED[back.dataset.autoVar] });
    }
    const preset = themes.find((th) => th.name === e.target.closest('[data-preset]')?.dataset.preset);
    if (preset) return savePreset(preset.values, preset.name);
    const a = e.target.closest('[data-page]')?.dataset.page;
    if (a === 'theme') {
      // automatic colours keep their formula unless the user picked one
      const values = Object.fromEntries([...body.querySelectorAll('[data-var]:not([data-auto])')].map((i) => [i.dataset.var, i.value.trim()]));
      scope === 'page' ? saveOwn(values) : saveTheme(values);
    }
    if (a === 'reset-own') saveOwn({});
    if (a === 'reset-preset' && madeFrom) savePreset(madeFrom.values, madeFrom.name);
    if (a === 'site-undo') siteApi('/head/undo', {}).then((j) => toast(t('Undone: {label}', { label: j.result })), (err) => toast(err.message, true));
    if (a === 'share') siteApi('/theme/share', { page: S.site.current }).then((j) => toast(t('Every page now uses this theme ({n} pages changed).', { n: j.result.length })), (err) => toast(err.message, true));
    if (a === 'add-theme') save(themeVariables + html);
    if (a === 'save') save(p.head);
    if (a === 'revert') {
      p.head = null;
      renderPage(body);
    }
    if (a === 'clean-files')
      api('/assets/clean', {}).then(({ result }) => (toast(result.files === 1 ? t('One unused file moved to {trash}.', { trash: result.trash }) : t('{n} unused files moved to {trash}.', { n: result.files, trash: result.trash })), renderPage(body)), (err) => toast(err.message, true));
  };
}

/** The export's address: the whole site (or lone page), or one page of the site. */
const exportURL = (path, q) => `/_tykerf/${path}${(q = new URLSearchParams(q)).size ? `?${q}` : ''}`;

/** Download the page (or the whole site, or one page of it) as a .zip of plain files, and say what the export found. */
async function exportZip(files, page) {
  try {
    const r = await fetch(exportURL('export.zip', { ...(files && { links: 'files' }), ...(page && { page }) }));
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'export.zip';
    const report = JSON.parse(r.headers.get('x-tykerf-report') ?? '{}');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const details = [
      report.broken ? (page ? t('{n} links lead to other pages of the site, which aren\'t in this export.', { n: report.broken }) : t('{n} links point at pages that don\'t exist.', { n: report.broken })) : '',
      report.remote ? t('{n} images, fonts or files still load from other servers; copy the ones you may use into the page before publishing.', { n: report.remote }) : '',
    ].filter(Boolean).join(' ');
    toast(`${t('Exported {pages} pages ({kb} KB).', { pages: report.pages ?? 1, kb: Math.round((report.bytes ?? 0) / 1024) })}${details ? ` ${details}` : ''}`, !!report.broken);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Code tab: content, style, or both ----------

const CODE_TABS = [['html', () => t('Content')], ['css', () => t('Style')], ['full', () => t('Full code')]];
const joinCode = (html, css) => (css.trim() ? `<style>\n${css.replace(/\s+$/, '')}\n</style>\n${html}` : html);

async function renderCode(body, id) {
  body.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
  const box = await loadBox(id);
  if (S.sel !== id || per(id).tab !== 'code') return;
  const p = per(id);
  p.codeTab ??= 'html';
  p.code ??= { html: box.html, css: box.css, full: null };
  const value = () => (p.codeTab === 'full' ? (p.code.full ??= joinCode(p.code.html, p.code.css)) : p.code[p.codeTab]);
  body.innerHTML = `
    <div class="subtabs">${CODE_TABS.map(([k, l]) => `<button data-code="${k}" aria-selected="${p.codeTab === k}">${l()}</button>`).join('')}
      <span class="hint">${p.codeTab === 'css' ? t('Scoped to this box: plain selectors are safe') : p.codeTab === 'html' ? t('Markup, text and scripts') : t('Style and content together')}</span></div>
    <textarea class="code" spellcheck="false" wrap="off">${esc(value())}</textarea>
    <div class="savebar"><span class="status"></span><button data-c="revert">${t('Revert')}</button><button data-c="save" class="primary" title="⌘S">${t('Save code')}</button></div>`;
  const ta = $('textarea.code', body);
  const status = $('.status', body);
  const dirty = () => (p.code.full !== null ? p.code.full !== joinCode(box.html, box.css) : p.code.html !== box.html || p.code.css !== box.css);
  const mark = () => (status.textContent = dirty() ? t('Unsaved changes') : '');
  mark();
  ta.oninput = () => {
    if (p.codeTab === 'full') p.code.full = ta.value;
    else {
      p.code[p.codeTab] = ta.value;
      p.code.full = null;
    }
    mark();
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      ta.oninput();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  };
  const save = async () => {
    try {
      await api('/box', p.code.full !== null && p.codeTab === 'full' ? { id, full: p.code.full } : { id, html: p.code.html, css: p.code.css });
      p.code = null;
      p.box = null;
      toast(t('Code saved'));
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  };
  body.onclick = (e) => {
    const sub = e.target.closest('[data-code]');
    if (sub) {
      // leaving Full code: split it back into content and style
      if (p.codeTab === 'full' && sub.dataset.code !== 'full' && p.code.full !== null) {
        const css = [];
        p.code.html = p.code.full.replace(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>\s*/gi, (_m, c) => (css.push(c.replace(/^\s*\n|\s+$/g, '')), '')).trim();
        p.code.css = css.filter(Boolean).join('\n');
      }
      if (sub.dataset.code === 'full') p.code.full = null;
      p.codeTab = sub.dataset.code;
      return renderCode(body, id);
    }
    const a = e.target.closest('[data-c]')?.dataset.c;
    if (a === 'revert') {
      p.code = null;
      return renderCode(body, id);
    }
    if (a === 'save') save();
  };
}

// ---------- Size tab ----------

function renderSize(body, id) {
  const row = sizingRow(id), col = sizingColumn(id);
  const mineIn = (c) => [id, ...ancestors(id)].find((x) => c.children.some((k) => k.id === x));
  let html = '';
  // the block's look: a band tone from the theme, and how tightly it is packed (tags tone-*, dense)
  const tags = info(id).node.tags ?? [];
  const tone = ['alt', 'soft', 'dark'].find((x) => tags.includes(`tone-${x}`)) ?? '';
  const dense = tags.includes('dense');
  const choice = (attr, v, on, label, title) => `<button data-${attr}="${v}" aria-pressed="${on}" title="${title}">${label}</button>`;
  const lookHtml = `<section class="size-sec" data-sec="look"><p class="size-head">${t('Look of {block}', { block: esc(id) })} <span class="muted">${t('(the band behind it and how tightly it is packed; the theme gives the colours)')}</span></p>
    <div class="look-row"><span class="look-label">${t('Band')}</span><div class="choice-seg" role="radiogroup" aria-label="${t('Band')}">
      ${choice('tone', '', !tone, t('None'), t('The page\'s background'))}${choice('tone', 'alt', tone === 'alt', t('Alternate'), t('A shade of the background, to set a section apart'))}${choice('tone', 'soft', tone === 'soft', t('Soft'), t('A soft wash of the accent'))}${choice('tone', 'dark', tone === 'dark', t('Dark'), t('The dark band: its text turns light. Once or twice a page, for a footer or a strong section'))}</div></div>
    <div class="look-row"><span class="look-label">${t('Density')}</span><div class="choice-seg" role="radiogroup" aria-label="${t('Density')}">
      ${choice('dense', 'no', !dense, t('Normal'), t('The space the theme gives'))}${choice('dense', 'yes', dense, t('Dense'), t('Less space around it and smaller titles, whatever the theme'))}</div></div>
    ${Object.keys(S.kit.tags).length ? `<div class="look-row"><span class="look-label">${t('Site tags')}</span><div class="tag-row">${Object.entries(S.kit.tags).map(([tg, v]) => `<button data-sitetag="${esc(tg)}" aria-pressed="${tags.includes(tg)}" title="${esc(v.description ?? v.label)}">${esc(v.label)}</button>`).join('')}</div></div>` : ''}
  </section>`;
  html += lookHtml;
  if (row) {
    const inside = row.id === id ? null : mineIn(row);
    const pct = shares(weightsOf(row));
    html += `<section class="size-sec" data-sec="w"><p class="size-head">${t('Widths in {block}', { block: `<button class="link" data-pick="${esc(row.id)}">${esc(row.id)}</button>` })} <span class="muted">${t('(side by side)')}</span></p>
      <div class="sliders">${row.children.map((c, i) => `
        <label class="slider${c.id === inside ? ' mine' : ''}" data-child="${esc(c.id)}"><span class="name">${esc(c.id)}</span>
          <input type="range" min="5" max="95" step="1" value="${pct[i]}" data-i="${i}"><output>${pct[i]}%</output></label>`).join('')}</div>
      <div class="row"><button data-size="equal">${t('Equal widths')}</button></div></section>`;
  }
  if (col) {
    const inside = col.id === id ? null : mineIn(col);
    html += `<section class="size-sec" data-sec="h"><p class="size-head">${t('Heights in {block}', { block: `<button class="link" data-pick="${esc(col.id)}">${esc(col.id)}</button>` })} <span class="muted">${t('(stacked; a block is never shorter than its content)')}</span></p>
      <div class="sliders">${col.children.map((c) => {
        const now = Math.round(elOf(c.id)?.getBoundingClientRect().height ?? 0);
        const v = c.minH ?? now;
        return `<label class="slider${c.id === inside ? ' mine' : ''}" data-child="${esc(c.id)}"><span class="name">${esc(c.id)}</span>
          <input type="range" min="0" max="${Math.max(1200, Math.ceil((v * 2) / 100) * 100)}" step="10" value="${v}" data-h="${esc(c.id)}">
          <output>${c.minH == null ? t('auto') : `${c.minH} px`}</output>
          <button class="link auto" data-auto="${esc(c.id)}" ${c.minH == null ? 'hidden' : ''} title="${t('Height follows the content')}">${t('auto')}</button></label>`;
      }).join('')}</div></section>`;
  }
  const wid = widthBlock(id);
  const room = wid && roomOf(id);
  if (room?.width) {
    const maxW = info(id).node.maxW;
    const full = Math.round(room.width);
    html += `<section class="size-sec" data-sec="mw"><p class="size-head">${t('Width of {block}', { block: esc(id) })} <span class="muted">${t('(narrower than the space it has, centred)')}</span></p>
      <div class="sliders"><label class="slider mine"><span class="name">${esc(id)}</span>
        <input type="range" min="80" max="${full}" step="10" value="${Math.min(maxW ?? full, full)}" data-mw="${esc(id)}">
        <output>${maxW == null ? t('full') : `${maxW} px`}</output>
        <button class="link auto" data-full="${esc(id)}" ${maxW == null ? 'hidden' : ''} title="${t('As wide as the space it has')}">${t('full')}</button></label></div></section>`;
  }

  body.innerHTML = html + `<p class="hint">${t('Or drag the handles on the page: between blocks side by side for widths, on the right edge of the selected block to make it narrower, on the bottom edge of stacked blocks for heights (double-click: back to auto or full width).')}</p>`;
  body.oninput = (e) => {
    const r = e.target.closest('input[type=range]');
    if (!r) return;
    if (r.dataset.mw) {
      const px = +r.value >= +r.max - 5 ? null : +r.value;
      previewWidth(r.dataset.mw, px);
      r.nextElementSibling.textContent = px === null ? t('full') : `${px} px`;
      return;
    }
    if (r.dataset.h) {
      previewHeight(r.dataset.h, +r.value);
      r.nextElementSibling.textContent = `${r.value} px`;
      return;
    }
    const i = +r.dataset.i, p = +r.value / 100;
    const ws = [...weightsOf(row)];
    const others = ws.reduce((a, b) => a + b, 0) - ws[i];
    ws[i] = (p / (1 - p)) * others;
    previewWeights(row, ws);
    syncSliders(row, i);
  };
  body.onchange = (e) => {
    const r = e.target.closest('input[type=range]');
    if (!r) return;
    if (r.dataset.mw) commitWidth(r.dataset.mw, +r.value >= +r.max - 5 ? null : +r.value);
    else if (r.dataset.h) commitHeight(r.dataset.h, +r.value);
    else if (preview) commitWeights(row, preview.weights);
  };
  body.onclick = (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) return select(pick.dataset.pick, { scroll: true });
    const auto = e.target.closest('[data-auto]');
    if (auto) return commitHeight(auto.dataset.auto, null);
    const full = e.target.closest('[data-full]');
    if (full) return commitWidth(full.dataset.full, null);
    if (e.target.closest('[data-size=equal]')) commitWeights(row, row.children.map(() => 1));
    const tb = e.target.closest('[data-tone]');
    if (tb) return op({ op: 'look', id, tone: tb.dataset.tone || null }, () => (tb.dataset.tone ? t('{id}: band {band}', { id, band: tb.textContent }) : t('{id}: no band', { id })));
    const st = e.target.closest('[data-sitetag]');
    if (st) {
      const on = st.getAttribute('aria-pressed') !== 'true';
      return op({ op: 'tag', id, tag: st.dataset.sitetag, on }, () => (on ? t('{id}: {tag}', { id, tag: st.textContent }) : t('{id}: no {tag}', { id, tag: st.textContent })));
    }
    const db = e.target.closest('[data-dense]');
    if (db) return op({ op: 'look', id, dense: db.dataset.dense === 'yes' }, () => (db.dataset.dense === 'yes' ? t('{id}: dense', { id }) : t('{id}: normal density', { id })));
  };
  body.onpointerover = (e) => {
    S.hover = e.target.closest('[data-child]')?.dataset.child ?? null;
    redraw();
  };
}

/** Update the slider values shown (except the one being dragged) after a preview change. */
function syncSliders(row, except = -1) {
  const body = $('.work .tab-body[data-pane="size"] [data-sec="w"]');
  if (!body) return;
  const pct = shares(weightsOf(row));
  body.querySelectorAll('input[type=range]').forEach((r) => {
    const i = +r.dataset.i;
    if (i !== except) r.value = pct[i];
    r.nextElementSibling.textContent = `${pct[i]}%`;
  });
}

// ---------- Blocks tab (containers): the blocks inside, in order ----------

const TONE_LABEL = { 'tone-alt': () => t('Alternate band'), 'tone-soft': () => t('Soft band'), 'tone-dark': () => t('Dark band'), dense: () => t('Dense') };
/** Small labels for a block's band and density (set in the Size tab), so they show in the list. */
const lookChips = (n) => (n.tags ?? []).filter((x) => x in TONE_LABEL).map((x) => `<span class="chip ${x}">${esc(TONE_LABEL[x]())}</span>`).join('');

function renderBlocks(body, id) {
  const n = info(id).node;
  body.innerHTML = `<ol class="blocks">${n.children.map((c) => `
      <li><button data-pick="${esc(c.id)}"><span class="icon ${c.kind}">${iconOf(c)}</span><span class="name">${esc(c.id)}</span>${lookChips(c)}<span class="muted">${esc(kindLabel(c))}</span></button></li>`).join('')}</ol>
    <p class="hint">${n.arrangement === 'row' ? t('Order is left to right.') : n.arrangement === 'column' ? t('Order is top to bottom.') : t('Order is top, left, centre, right, bottom.')}</p>`;
  body.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) select(b.dataset.pick, { scroll: true });
  };
  body.onpointerover = (e) => {
    S.hover = e.target.closest('[data-pick]')?.dataset.pick ?? null;
    redraw();
  };
}

// ---------- AI tab: one conversation per block ----------

const RUNNER_LABEL = { 'claude-code': () => t('Claude Code'), anthropic: () => t('Anthropic API'), gemini: () => t('Gemini API') };

/** What a request left unfinished (src/check.ts): Kaity's own pass over it, or the person's choice to fix or keep it. */
function checkMessage(m, busy) {
  const items = m.items ?? [], n = items.length;
  const head = {
    auto: n === 1 ? t('Kaity checks the 1 thing she left unfinished') : t('Kaity checks the {n} things she left unfinished', { n }),
    open: n === 1 ? t('Kaity left 1 thing unfinished') : t('Kaity left {n} things unfinished', { n }),
    fixing: n === 1 ? t('Kaity was asked to finish 1 thing') : t('Kaity was asked to finish {n} things', { n }),
    left: n === 1 ? t('1 thing left as it is') : t('{n} things left as they are', { n }),
  }[m.state] ?? esc(m.text);
  const shown = m.state === 'open' ? 8 : 3;
  const list = `<ul>${items.slice(0, shown).map((i) => `<li>${esc(i.text)}</li>`).join('')}${n > shown ? `<li class="more">${t('and {n} more', { n: n - shown })}</li>` : ''}</ul>`;
  const actions = m.state === 'open' ? `<div class="row"><button data-check="fix" class="primary" ${busy ? 'disabled' : ''}>${t('Fix them')}</button><button data-check="leave" ${busy ? 'disabled' : ''}>${t('Leave them as they are')}</button></div>` : '';
  return `<div class="msg check ${esc(m.state ?? '')}"><b>${head}</b>${list}${actions}</div>`;
}

async function renderAI(body, id) {
  const p = per(id);
  const chat = await api(`/chat?id=${encodeURIComponent(id)}`).catch(() => ({ messages: [] }));
  if (S.sel !== id || p.tab !== 'ai') return;
  const busyHere = S.ai?.id === id, busyElsewhere = S.ai && !busyHere;
  const msgs = [];
  for (const m of chat.messages) {
    if (m.role === 'step' && msgs.at(-1)?.role === 'steps') msgs.at(-1).items.push(m.text);
    else if (m.role === 'step') msgs.push({ role: 'steps', items: [m.text] });
    else msgs.push(m);
  }
  // the chat is drawn again on every step: keep the reader's place, and follow the end only from the end
  const old = $('.chat', body);
  const atEnd = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 40;
  const was = old?.scrollTop ?? 0;
  // a step list stays as the person left it; the one of a run in progress is open, so its steps can be followed
  p.stepsOpen ??= {};
  const open = (i) => p.stepsOpen[i] ?? (busyHere && i === msgs.length - 1);
  body.innerHTML = `
    <div class="chat">${msgs.length ? msgs.map((m, i) => m.role === 'check' ? checkMessage(m, busyHere || busyElsewhere) : m.role === 'steps'
      ? `<details class="steps" data-steps="${i}" ${open(i) ? 'open' : ''}><summary>${m.items.length === 1 ? t('1 step') : t('{n} steps', { n: m.items.length })}</summary>${m.items.map((s) => `<div>${esc(s)}</div>`).join('')}</details>`
      : `<div class="msg ${m.role}">${m.role === 'ai' ? `<span class="who">${kaityMark()}Kaity</span>` : ''}${m.images?.length ? `<div class="pics">${m.images.map((f) => `<a href="${API}/image/${esc(f)}" target="_blank"><img src="${API}/image/${esc(f)}" alt="${t('attached image')}"></a>`).join('')}</div>` : ''}${m.role === 'ai' ? `<div class="md">${markdown(m.text)}</div>` : esc(m.text)}</div>`).join('')
      : `<p class="muted">${isBox(id) ? t('Ask Kaity about {id}. It can only change this box, and it remembers this conversation.', { id: `<b>${esc(id)}</b>` }) : t('Ask Kaity about {id}. It can only change this block and what is inside it, and it remembers this conversation.', { id: `<b>${esc(id)}</b>` })}</p>`}
      ${busyHere ? `<div class="msg working">${kaityMark(true)}${t('Kaity is working')}<span class="dots"></span></div>` : ''}</div>
    <div class="composer">
      ${busyElsewhere ? `<p class="elsewhere">${kaityMark(true)}<span>${t('Kaity is working on {id}.', { id: `<b>${esc(S.ai.id)}</b>` })}</span><button data-ai="goto">${t('Go there')}</button></p>` : ''}
      <div class="kaity-head">${kaityMark(busyHere)}<b>Kaity</b><span>${isBox(id) ? t('works on {id} only', { id: `<b>${esc(id)}</b>` }) : t('works on {id} and what is inside it', { id: `<b>${esc(id)}</b>` })}</span>${S.aiRunner ? `<span class="runner" title="${t('The model Kaity uses. Set with TYKERF_RUNNER and TYKERF_MODEL; see the guide to Kaity.')}">${esc(RUNNER_LABEL[S.aiRunner.runner]?.() ?? S.aiRunner.runner)}${S.aiRunner.model && S.aiRunner.runner !== 'claude-code' ? ` · ${esc(S.aiRunner.model)}` : ''}</span>` : ''}</div>
      <div class="attach" hidden></div>
      <textarea rows="2" placeholder="${busyElsewhere ? t('Kaity is working on {id}…', { id: esc(S.ai.id) }) : isBox(id) ? t('e.g. make the title shorter and add a button') : t('e.g. make these three cards the same height')}" ${busyElsewhere ? 'disabled' : ''}>${esc(p.aiDraft ?? '')}</textarea>
      <div class="row">
        <button data-ai="pick" ${busyElsewhere ? 'disabled' : ''} title="${t('Attach a screenshot, sketch or reference design (you can also paste or drop one)')}">${ic('image')}${t('Add image')}</button>
        ${chat.messages.length && !busyHere ? `<button data-ai="reset" class="link">${t('New conversation')}</button>` : ''}
        <span class="spacer"></span>
        ${busyHere ? `<button data-ai="stop">${t('Stop')}</button>` : `<button data-ai="send" class="primary" ${busyElsewhere ? 'disabled' : ''}>${t('Ask Kaity')}</button>`}
      </div>
    </div>`;
  const log = $('.chat', body);
  log.scrollTop = atEnd ? log.scrollHeight : was;
  // remember a list the person opens or closes (a click on its summary, before the details toggles)
  for (const d of log.querySelectorAll('details.steps')) $('summary', d).onclick = () => (p.stepsOpen[d.dataset.steps] = !d.open);
  const ta = $('.composer textarea', body);
  ta.oninput = () => (p.aiDraft = ta.value);
  p.images ??= [];
  const strip = $('.attach', body);
  const showImages = () => {
    strip.hidden = !p.images.length;
    strip.innerHTML = p.images.map((im, i) => `<span class="thumb"><img src="data:${im.mediaType};base64,${im.data}" alt=""><button data-unattach="${i}" title="${t('Remove')}">×</button></span>`).join('');
  };
  const attach = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (p.images.length >= 5) return toast(t('At most 5 images per message'), true);
      try {
        p.images.push(await shrinkImage(f));
      } catch (err) {
        toast(err.message, true);
      }
    }
    showImages();
  };
  showImages();
  ta.onpaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      attach(files);
    }
  };
  const composer = $('.composer', body);
  composer.ondragover = (e) => {
    e.preventDefault();
    composer.classList.add('drop');
  };
  composer.ondragleave = () => composer.classList.remove('drop');
  composer.ondrop = (e) => {
    e.preventDefault();
    composer.classList.remove('drop');
    attach([...(e.dataTransfer?.files ?? [])]);
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const send = async () => {
    const prompt = ta.value.trim();
    if (!prompt || S.ai) return;
    const r = rectOf(id);
    try {
      await api('/ask', { id, prompt, size: r ? `${Math.round(r.w)}×${Math.round(r.h)} px` : undefined, images: p.images.map(({ mediaType, data }) => ({ mediaType, data })) });
      p.aiDraft = '';
      p.images = [];
      S.ai = { id };
    } catch (err) {
      toast(err.message, true);
    }
  };
  body.onclick = async (e) => {
    const un = e.target.closest('[data-unattach]');
    if (un) {
      p.images.splice(+un.dataset.unattach, 1);
      return showImages();
    }
    const check = e.target.closest('[data-check]')?.dataset.check;
    if (check) {
      await api(`/check/${check}`, { id }).catch((err) => toast(err.message, true));
      return renderAI(body, id);
    }
    const a = e.target.closest('[data-ai]')?.dataset.ai;
    if (a === 'pick') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true });
      input.onchange = () => attach([...input.files]);
      return input.click();
    }
    if (a === 'goto' && S.ai) return select(S.ai.id, { scroll: true, tab: 'ai' });
    if (a === 'send') send();
    if (a === 'stop') api('/ask/cancel', {}).catch(() => {});
    if (a === 'reset') {
      await api('/chat/reset', { id }).catch((err) => toast(err.message, true));
      p.stepsOpen = {};
      renderAI(body, id);
    }
  };
  if (!busyElsewhere && document.activeElement === host) ta.focus();
}

/**
 * Read an image file for the AI, scaled down so its long side is at most 1568 px (larger images
 * are scaled down by the model anyway and only cost more). Returns { mediaType, data (base64) }.
 */
async function shrinkImage(file) {
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

// ---------- the site: its pages, and new ones ----------
// In a site (a folder of pages) the header shows the current page; it lists the others and makes
// new ones from a layout and a theme (chooser.js, shared with the start screen).

const pageSwitch = $('.pagesw');
function renderSwitcher() {
  pageSwitch.hidden = !S.site;
  $('.managebtn').hidden = !S.site; // the site manager, next to Edit with TYKERF
  if (S.site) pageSwitch.innerHTML = `<span>${esc(S.site.current)}</span>${ICON.chevron}`;
}
pageSwitch.addEventListener('click', () => openPages());
/** The site's pages to switch to; the current one has small Rename and Remove buttons; All pages (the site's home) and New page… end the list. */
function openPages() {
  const r = pageSwitch.getBoundingClientRect();
  popover(r.left, r.bottom + 6, `<nav class="pages" aria-label="${t('Pages')}">${S.site.pages.map((p) => p === S.site.current
    ? `<div class="page-row" aria-current="page"><a href="/${encodeURIComponent(p)}/" aria-current="page">${esc(p)}</a>
        <button class="mini" data-pg="rename" title="${t('Rename this page…')}" aria-label="${t('Rename this page…')}">${ic('rename')}</button>
        <button class="mini danger" data-pg="remove" title="${t('Remove this page…')}" aria-label="${t('Remove this page…')}">${ic('delete')}</button></div>`
    : `<a href="/${encodeURIComponent(p)}/">${esc(p)}</a>`).join('')}</nav>
    <a class="newpage-btn" href="/_tykerf/site/">${ic('site')}${t('All pages')}</a>
    <button class="newpage-btn" data-pg="new">${ic('inside')}${t('New page…')}</button>`);
  pop.onclick = (e) => {
    const b = e.target.closest('[data-pg]')?.dataset.pg;
    if (b === 'new') closePop(), openNewPage();
    if (b === 'rename') renamePagePrompt();
    if (b === 'remove') removePagePrompt();
  };
}

// ---------- the Site menu: what acts on the whole site or on TYKERF itself ----------
// Export and the AI's status. Only things that act on the whole site or on TYKERF itself belong here:
// pages are managed in the page list, a page's own theme and head in its Page tab.

const siteBtn = $('.sitebtn');
const anchor = () => siteBtn.getBoundingClientRect();
siteBtn.addEventListener('click', () => openSiteMenu());
function openSiteMenu() {
  const r = anchor();
  const entry = (act, icon, label, cls = '') => `<button data-site="${act}" class="${cls}">${ic(icon)}${label}</button>`;
  popover(r.left, r.bottom + 6, `<div class="sitemenu" role="menu">
    ${S.site ? entry('manage', 'site', t('Manage the site…')) : ''}
    ${entry('export', 'download', S.site ? t('Export the site…') : t('Export the page…'))}
    ${S.site?.current ? entry('export-page', 'download', t('Export this page…')) : ''}
    ${entry('ai', 'ai', t('Kaity status…'))}
  </div>`);
  pop.querySelector('[data-site]')?.focus();
  pop.onclick = (e) => {
    const b = e.target.closest('[data-site]')?.dataset.site;
    if (b === 'manage') location.href = '/_tykerf/site/';
    if (b === 'export') exportPrompt();
    if (b === 'export-page') exportPrompt(S.site.current);
    if (b === 'ai') aiStatus();
  };
}

/** Export: what it will hold and what to check, then the download (exportZip). `page`: one page of the site. */
async function exportPrompt(page) {
  const r = anchor();
  popover(r.left, r.bottom + 6, `<p class="muted">${t('Loading…')}</p>`);
  let report;
  try {
    const j = await (await fetch(exportURL('export/report', page ? { page } : {}))).json();
    if (!j.ok) throw new Error(j.error);
    ({ report } = j);
  } catch (err) {
    return toast(err.message, true);
  }
  const kb = Math.round(report.bytes / 1024);
  const hosts = [...new Set(report.remote.map((x) => { try { return new URL(x.url, location.href).host; } catch { return x.url; } }))];
  const whole = S.site && !page;
  popover(r.left, r.bottom + 6, `<p><b>${whole ? t('Export the site') : page ? t('Export this page') : t('Export the page')}</b></p>
    <p class="hint">${page ? t('The page {page} ({kb} KB) as plain files in a .zip, with the site\'s theme and fonts. Its links to other pages of the site lead nowhere until those pages are next to it. TYKERF, its history and the conversations with Kaity stay out.', { page: esc(page), kb }) : whole ? t('Every page of the site, {n} in all ({kb} KB), as plain files in a .zip: links between pages and images keep working wherever you put them. TYKERF, its history and the conversations with Kaity stay out.', { n: report.pages.length, kb }) : t('This page ({kb} KB) as plain files in a .zip. TYKERF, its history and the conversations with Kaity stay out.', { kb })}</p>
    ${report.broken.length ? `<div class="report${page ? '' : ' bad'}"><b>${page ? t('Links to other pages') : t('Links to pages that don\'t exist')}</b>${report.broken.map((b) => `<div>${esc(b.page)} → <code>${esc(b.href)}</code></div>`).join('')}</div>` : ''}
    ${report.remote.length ? `<div class="report"><b>${t('Still loaded from other servers')}</b><div>${t('{n} images, fonts or files from {hosts}. Copy the ones you may use into the page before publishing.', { n: report.remote.length, hosts: esc(hosts.join(', ')) })}</div></div>` : ''}
    <div class="choices">
      <button data-x="web" class="choice"><b>${ic('download')}${t('For a web server')}</b><span>${t('Links end in a folder (../about/), as web hosts serve them.')}</span></button>
      <button data-x="files" class="choice"><b>${ic('download')}${t('To open from disk')}</b><span>${t('Links end in index.html, so you can double-click the files without a web server.')}</span></button>
    </div>`);
  pop.onclick = (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    closePop();
    exportZip(x === 'files', page);
  };
}

const RUNNER_HELP = {
  'claude-code': () => t('Your own Claude Code, signed in with your Claude account.'),
  anthropic: () => t('The Anthropic API or a compatible endpoint, with the key in .env.'),
  gemini: () => t('Google\'s Gemini API, with the key in .env.'),
};

/** Which AI answers, whether it is ready, a test request, and what is running now. */
async function aiStatus() {
  const r = anchor();
  let st;
  try {
    st = await (await fetch('/_tykerf/ai/status')).json();
  } catch (err) {
    return toast(err.message, true);
  }
  const running = st.running.map((x) => (x.page ? t('{id} in the page {page}', { id: `<b>${esc(x.id)}</b>`, page: esc(x.page) }) : `<b>${esc(x.id)}</b>`));
  popover(r.left, r.bottom + 6, `<p class="kaity-title">${kaityMark(st.running.length > 0)}<b>Kaity</b> <span class="runner">${esc(RUNNER_LABEL[st.runner]?.() ?? st.runner)}${st.model ? ` · ${esc(st.model)}` : ''}</span></p>
    <p class="hint">${RUNNER_HELP[st.runner]?.() ?? ''}</p>
    <p class="status-line ${st.ready ? 'ok' : 'bad'}">${st.ready ? '●' : '○'} ${esc(st.task)}</p>
    <p class="hint">${running.length ? t('Working now on {what}.', { what: running.join(', ') }) : t('Not working on anything now.')}</p>
    <p class="hint">${t('Change the runner and the model with TYKERF_RUNNER and TYKERF_MODEL in .env (see .env.example), then restart TYKERF.')}</p>
    <div class="test-result" hidden></div>
    <div class="row">${st.testable ? `<button data-t="test" class="primary" ${st.ready ? '' : 'disabled'}>${t('Test')}</button>` : ''}</div>`);
  pop.onclick = async (e) => {
    const b = e.target.closest('[data-t="test"]');
    if (!b) return;
    const out = $('.pop .test-result');
    b.disabled = true;
    out.hidden = false;
    out.className = 'test-result';
    out.textContent = t('Sending a short request…');
    try {
      const j = await (await fetch('/_tykerf/ai/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
      out.className = `test-result ${j.ok ? 'ok' : 'bad'}`;
      out.textContent = j.ok ? t('It answered "{answer}" in {s} s.', { answer: j.answer, s: (j.ms / 1000).toFixed(1) }) : j.error;
    } catch (err) {
      out.className = 'test-result bad';
      out.textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}

/** The site's own API (pages, renames), at the site root whatever page is open. */
async function siteApi(path, body) {
  const r = await fetch(`/_tykerf/site${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function renamePagePrompt() {
  const r = pageSwitch.getBoundingClientRect();
  const name = S.site.current;
  popover(r.left, r.bottom + 6, `<label class="pop-field"><span>${t('New name for this page')}</span><input class="pgname" value="${esc(name)}" spellcheck="false" autocomplete="off"></label>
    <p class="hint">${t('Links to it from the other pages of the site change too.')}</p>
    <div class="row"><button data-r="cancel">${t('Cancel')}</button><button data-r="ok" class="primary">${t('Rename')}</button></div>`);
  const input = $('.pop .pgname');
  input.focus();
  input.select();
  const go = async () => {
    const to = input.value.trim();
    if (!to || to === name) return closePop();
    try {
      const j = await siteApi('/rename', { name, to });
      closePop();
      location.replace(j.url);
    } catch (err) {
      toast(err.message, true);
    }
  };
  pop.onclick = (e) => {
    const b = e.target.closest('[data-r]')?.dataset.r;
    if (b === 'cancel') closePop();
    if (b === 'ok') go();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') e.preventDefault(), go();
    if (e.key === 'Escape') e.preventDefault(), closePop();
  };
}

async function removePagePrompt() {
  const r = pageSwitch.getBoundingClientRect();
  const name = S.site.current;
  const { links } = await siteApi('/links').catch(() => ({ links: [] }));
  const from = new Set(links.filter((l) => l.to === name && l.page !== name).map((l) => l.page));
  const n = links.filter((l) => l.to === name && l.page !== name).length;
  popover(r.left, r.bottom + 6, `<p><b>${t('Remove the page {page} from the site?', { page: esc(name) })}</b></p>
    <p class="hint">${n === 1 ? t('One link to it from {pages} will point nowhere.', { pages: esc([...from].join(', ')) }) : n ? t('{n} links to it from {pages} will point nowhere.', { n, pages: esc([...from].join(', ')) }) : t('No other page links to it.')} ${t('Nothing is deleted: the page is kept in the site\'s .trash folder.')}</p>
    <div class="row"><button data-r="cancel">${t('Cancel')}</button><button data-r="ok" class="danger">${t('Remove')}</button></div>`);
  pop.onclick = async (e) => {
    const b = e.target.closest('[data-r]')?.dataset.r;
    if (b === 'cancel') closePop();
    if (b !== 'ok') return;
    try {
      const j = await siteApi('/remove', { name });
      closePop();
      location.replace(j.url);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

const newPage = $('.newpage');
let chooserSheet = null;
async function openNewPage() {
  // the chooser's styles join the editor's in the shadow root
  if (!chooserSheet) {
    chooserSheet = new CSSStyleSheet();
    chooserSheet.replaceSync(await (await fetch('/_tykerf/chooser.css')).text());
    ui.adoptedStyleSheets = [...ui.adoptedStyleSheets, chooserSheet];
  }
  const { openMadePage, renderChooser } = await import('/_tykerf/chooser.js');
  newPage.hidden = false;
  let n = S.site.pages.length + 1;
  while (S.site.pages.includes(`page-${n}`)) n++;
  await renderChooser($('.np-box', newPage), {
    t,
    name: `page-${n}`,
    taken: S.site.pages,
    like: S.site.current,
    sharedTheme: !!S.site.sharedTheme,
    onCancel: closeNewPage,
    onCreate: async (choice) => {
      const r = await fetch('/_tykerf/site/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(choice) });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      openMadePage(j);
    },
  });
}
function closeNewPage() {
  newPage.hidden = true;
  $('.np-box', newPage).innerHTML = '';
}
newPage.addEventListener('keydown', (e) => e.key === 'Escape' && (e.preventDefault(), closeNewPage()));
newPage.addEventListener('pointerdown', (e) => e.target === newPage && closeNewPage());

// ---------- a page being made: the job's progress, then how to go on ----------
// The AI building a new page, or a copy of a website, runs on the server while this modal shows each
// step. The page behind it updates as the work goes on, with the editor out of sight (only the page
// and the modal), but can't be clicked until it is done, so nothing gets in the way of the AI. The X stops the work. At the end: a short guide, and the choice
// between the editor and the page as visitors see it.

const jobModal = $('.jobmodal');
let jobConfirm = false;
// ---------- the page coming into focus while Kaity builds it ----------
// Boxes Kaity hasn't reached yet are blurred hard, the ones she is on softly, and a finished one (no sample
// content left: check.ts) shows clearly. The server says which (state().build); a rule in the page's head
// does it, so it holds across the page's refreshes, and is updated after each so a box sharpens visibly.

const focusStyle = Object.assign(document.createElement('style'), { id: 'tykerf-focus' });
document.head.append(focusStyle);
let seeClearly = false; // "See the page clearly" in the build's card
let focusSeen = false; // once a build was shown, boxes keep their transition, so the last ones clear smoothly
function applyFocus() {
  const b = seeClearly ? null : S.build;
  if (b) focusSeen = true;
  const blur = (ids, px) => (ids.length ? `${ids.map((id) => `[data-sw="${CSS.escape(id)}"]`).join(', ')} { filter: blur(${px}px); }\n` : '');
  focusStyle.textContent = (focusSeen ? '[data-sw] { transition: filter .9s ease; }\n@media (prefers-reduced-motion: reduce) { [data-sw] { transition: none; } }\n' : '')
    + (b ? blur(b.strong, 14) + blur(b.soft, 5) : '');
}
/** After the page's body was replaced: let it show with the rules it had, then apply the new ones. */
function refocus() {
  void page().offsetHeight;
  requestAnimationFrame(applyFocus);
}

function renderJob(job) {
  if (job?.kind !== 'ai' || job.state !== 'running') (S.build = null), applyFocus(); // the build is over: all clear
  if (!job) return void ((jobModal.hidden = true), ($('.dock').hidden = false));
  jobModal.hidden = false;
  // the page is the show: the panel and the Edit button wait until the user picks what comes next
  if (S.on) setOn(false);
  $('.dock').hidden = true;
  // running: a card in the corner (tykerf.css); a stop being confirmed stays there too
  jobModal.classList.toggle('running', job.state === 'running');
  const box = $('.job-box', jobModal);
  const ai = job.kind === 'ai';
  const running = job.state === 'running';
  const steps = job.steps.map((st, i) => {
    const text = ai ? esc(st.text) : t(st.text, Object.fromEntries(Object.entries(st.vars ?? {}).map(([k, v]) => [k, esc(v)])));
    const now = running && i === job.steps.length - 1;
    return `<li class="${st.refused ? 'refused' : ''}${now ? ' now' : ''}">${st.refused ? `<b>${t('Refused:')}</b> ` : ''}${text}</li>`;
  }).join('');
  const title = running ? (ai ? t('Kaity is building your page') : t('Copying {site}', { site: esc(job.site ?? '') }))
    : job.state === 'done' ? t('Your page is ready')
    : job.state === 'stopped' ? (ai ? t('Stopped') : t('Copy stopped'))
    : t('Something went wrong');
  const lead = running
    ? (ai ? t('Watch it work, step by step. You can stop it at any time, and everything it does can be undone.') : t('TYKERF is opening the site, measuring it and cutting it into blocks. This usually takes under a minute.'))
    : job.state === 'stopped' ? (ai ? t('What Kaity built so far stays. Undo any step, or ask it to go on in the Kaity tab.') : t('This unfinished page is being removed.'))
    : job.state === 'failed' ? `${esc(job.error ?? '')} ${ai ? t('What Kaity built before that stays.') : t('The page stays empty: remove it from the page list, or try another address.')}`
    : '';
  const guide = `<ul class="job-guide">
      <li>${t('Click a block on the page, or in the tree, to select it.')}</li>
      <li>${t('Double-click text or a picture to change it where it is.')}</li>
      <li>${t('Open the Kaity tab of a block to ask for changes to that block only.')}</li>
      <li>${t('The Page tab of the top block changes colours and fonts for the whole site. Undo goes back one step at a time.')}</li></ul>`;
  const ended = !running && !(job.state === 'stopped' && !ai);
  // Kaity never shows without TYKERF (BRAND.md): the TYKERF logo heads the window, above Kaity's symbol and name
  box.innerHTML = `
    <div class="job-top"><span class="job-brand" title="TYKERF">${ICON.tykerf}<span class="wordmark">tykerf</span></span>
      ${running ? `<button class="job-x" data-job="ask-stop" title="${ai ? t('Stop Kaity') : t('Stop the copy')}" aria-label="${ai ? t('Stop Kaity') : t('Stop the copy')}">×</button>` : ''}</div>
    <div class="job-head"><h2>${running ? (ai ? kaityMark(true) : '<span class="spin" aria-hidden="true"></span>') : ''}${title}</h2></div>
    ${lead ? `<p class="job-lead">${lead}</p>` : ''}
    ${running && ai ? `<button class="job-clear" data-job="clear" aria-pressed="${seeClearly}">${seeClearly ? t('Show what Kaity is working on') : t('See the page clearly')}</button>` : ''}
    ${running && jobConfirm ? `<div class="job-confirm"><p>${ai ? t('Stop Kaity? What it built so far stays, and every step can be undone.') : t('Stop the copy? This unfinished page will be removed.')}</p>
      <div class="row end"><button data-job="keep">${t('Keep going')}</button><button data-job="stop" class="danger">${t('Stop')}</button></div></div>` : ''}
    ${steps ? `<ol class="job-steps">${steps}</ol>` : running ? `<p class="muted">${t('Starting…')}</p>` : ''}
    ${job.state === 'done' && job.answer ? `<blockquote class="job-answer"><div class="md">${markdown(job.answer)}</div></blockquote>` : ''}
    ${ended ? `${job.state !== 'failed' || ai ? guide : ''}
      <div class="row end"><button data-job="page">${t('See the page')}</button><button data-job="editor" class="primary">${t('Open the editor')}</button></div>
      <p class="hint">${t('Later, Edit with TYKERF at the bottom right opens the editor whenever you want.')}</p>` : ''}`;
  const list = $('.job-steps', box);
  if (list) list.scrollTop = list.scrollHeight;
  box.onclick = async (e) => {
    const a = e.target.closest('[data-job]')?.dataset.job;
    if (a === 'ask-stop') (jobConfirm = true), renderJob(job);
    if (a === 'keep') (jobConfirm = false), renderJob(job);
    if (a === 'clear') (seeClearly = !seeClearly), applyFocus(), renderJob(job);
    if (a === 'stop') {
      jobConfirm = false;
      await api('/job/stop', {}).catch((err) => toast(err.message, true));
    }
    if (a === 'editor' || a === 'page') {
      await api('/job/seen', {}).catch(() => {});
      jobModal.hidden = true;
      $('.dock').hidden = false;
      if (a === 'editor') {
        setOn(true);
        if (job.select && info(job.select)) {
          if (ai) per(job.select).tab = 'ai';
          select(job.select);
        }
      } else {
        setOn(false);
        // show where the editor is, for later
        toggle.classList.add('pulse');
        setTimeout(() => toggle.classList.remove('pulse'), 4000);
      }
    }
  };
}

// ---------- editing in place: popovers ----------
// Small actions (rename, delete, a link target) open a popover next to where they were asked for,
// instead of sending the user to the panel.

const pop = $('.pop');
function popover(x, y, html) {
  pop.innerHTML = html;
  pop.hidden = false;
  pop.onclick = null;
  pop.style.left = `${Math.max(8, Math.min(x, innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(y, innerHeight - pop.offsetHeight - 8))}px`;
}
const closePop = () => {
  pop.hidden = true;
  pop.innerHTML = '';
  pop.onclick = null;
};

function renameHere(id, x, y) {
  popover(x, y, `<label class="pop-field"><span>${t('New name for {id}', { id: esc(id) })}</span><input class="nm" value="${esc(id)}" spellcheck="false"></label>
    <div class="row"><button data-r="cancel">${t('Cancel')}</button><button data-r="ok" class="primary">${t('Rename')}</button></div>`);
  const input = $('.pop .nm');
  input.focus();
  input.select();
  const go = (ok) => {
    const name = input.value.trim();
    closePop();
    if (ok && name && name !== id) renameBlock(id, name);
  };
  pop.onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (b) go(b.dataset.r === 'ok');
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') e.preventDefault(), go(true);
    if (e.key === 'Escape') e.preventDefault(), closePop();
  };
}

async function removeHere(id, x, y) {
  popover(x, y, `<p class="muted">${t('Looking at the code…')}</p>`);
  const html = await removalChoices(id);
  if (pop.hidden) return;
  popover(x, y, html);
  pop.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closePop();
    if (b.dataset.act !== 'sheet-close') act(b.dataset.act, id, b.dataset);
  };
}

// ---------- editing in place: text ----------
// Double-click text in a box (or "Edit this text"): the element becomes editable where it is. Only
// its words and the marks <strong>, <em> and <a href> can change; inline.js cleans what the browser
// types, so no spans or inline styles reach the code. Structure stays in the Code tab. The change is
// saved through the box's code (one undo step), and only when the element there matches the page.

let editing = null; // { id, el, path, before, known, attrs }
let deferred = false; // a page refresh that waits until the edit (or the image tool) is done

const parseCode = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
};

/** The element in the box's code that a page element comes from, or null when they don't match. */
async function codeFor(id, el, same) {
  const boxEl = elOf(id);
  const path = boxEl && elementPath(el, boxEl);
  if (!path) return null;
  const box = await loadBox(id, true);
  const tpl = parseCode(box.html);
  const code = atPath(tpl.content, path);
  return same(el, code) ? { tpl, code, path } : null;
}

/** Text that can't be edited on the page is edited in the Text tab, with its field focused. */
function textTabFor(id, el) {
  per(id).focusText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  showPanel();
  select(id, { tab: 'text' });
  toast(t('This text is edited in the Text tab: it sits next to other elements, or the box changes it with a script.'));
}

async function startTextEdit(id, el, at) {
  if (editing) await finishEdit(true);
  closeMenu();
  closePop();
  const boxEl = elOf(id);
  const path = el?.isConnected && boxEl ? elementPath(el, boxEl) : null;
  if (!path) return;
  // editable at once, so nothing typed is lost; the code is checked meanwhile (and again on saving)
  editing = {
    id, el, path, before: el.innerHTML, known: new WeakSet(el.querySelectorAll('*')),
    attrs: { contenteditable: el.getAttribute('contenteditable'), style: el.getAttribute('style') },
  };
  el.setAttribute('contenteditable', 'true');
  el.style.outline = '2px solid #EA9A27';
  el.style.outlineOffset = '3px';
  el.addEventListener('keydown', onEditKey);
  el.addEventListener('paste', onEditPaste);
  el.addEventListener('drop', stopEvent);
  el.addEventListener('focusout', onEditBlur);
  el.focus();
  placeCaret(el, at);
  $('.tbar').hidden = false;
  placeToolbar();
  // compared with the element as it was when the edit started: the user may be typing already
  const before = editing.before;
  const found = await codeFor(id, el, (page, code) => code?.nodeName === page.nodeName && code.innerHTML === before).catch(() => null);
  if (!found && editing?.el === el) {
    await finishEdit(false);
    textTabFor(id, el);
  }
}

function placeCaret(el, at) {
  let r = null;
  if (at && document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(at.x, at.y);
    if (p && el.contains(p.offsetNode)) (r = document.createRange()).setStart(p.offsetNode, p.offset);
  } else if (at && document.caretRangeFromPoint) {
    const c = document.caretRangeFromPoint(at.x, at.y);
    if (c && el.contains(c.startContainer)) r = c;
  }
  if (!r) {
    r = document.createRange();
    r.selectNodeContents(el);
  }
  r.collapse(!at);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

const stopEvent = (e) => e.preventDefault();

function onEditKey(e) {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') e.preventDefault(), finishEdit(false);
  else if (e.key === 'Enter' && e.shiftKey) e.preventDefault(), document.execCommand('insertLineBreak');
  else if (e.key === 'Enter') e.preventDefault(), finishEdit(true);
  else if (mod && k === 'b') e.preventDefault(), document.execCommand('bold');
  else if (mod && k === 'i') e.preventDefault(), document.execCommand('italic');
  else if (mod && k === 'k') e.preventDefault(), linkPrompt();
  else if (mod && k === 's') e.preventDefault(), finishEdit(true);
  e.stopPropagation(); // the box's own scripts don't see the typing
}

/** Pasting adds words only: formatting and markup from elsewhere would end up in the code. */
function onEditPaste(e) {
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' '));
}

function onEditBlur(e) {
  // focus moving into TYKERF's own UI (the toolbar, the link field) keeps the edit open
  if (e.relatedTarget === host || (e.relatedTarget && editing?.el.contains(e.relatedTarget))) return;
  finishEdit(true);
}

const restoreAttr = (el, name, v) => (v === null ? el.removeAttribute(name) : el.setAttribute(name, v));

async function finishEdit(save) {
  const ed = editing;
  if (!ed) return;
  editing = null;
  $('.tbar').hidden = true;
  closePop();
  const { el } = ed;
  for (const [type, fn] of [['keydown', onEditKey], ['paste', onEditPaste], ['drop', stopEvent], ['focusout', onEditBlur]]) el.removeEventListener(type, fn);
  const html = save ? cleanInline(el, ed.known) : ed.before;
  restoreAttr(el, 'contenteditable', ed.attrs.contenteditable);
  restoreAttr(el, 'style', ed.attrs.style);
  if (document.activeElement === el) el.blur();
  getSelection()?.removeAllRanges();
  try {
    if (html !== ed.before) {
      const box = await loadBox(ed.id, true);
      const tpl = parseCode(box.html);
      const code = atPath(tpl.content, ed.path);
      if (!code || code.innerHTML !== ed.before) throw new Error(t('The box changed while you were typing, so your text was not saved.'));
      code.innerHTML = html;
      await api('/box', { id: ed.id, html: tpl.innerHTML });
      per(ed.id).box = null;
      per(ed.id).text = null;
      toast(t('Text saved'));
    } else if (!save) el.innerHTML = ed.before;
  } catch (err) {
    el.innerHTML = ed.before;
    toast(err.message, true);
  }
  afterInPlace();
}

/** A page refresh that came in while editing runs now. */
function afterInPlace() {
  if (!deferred || editing || tool) return;
  deferred = false;
  refresh().catch((e) => toast(e.message, true));
}

function placeToolbar() {
  const bar = $('.tbar');
  if (!editing || bar.hidden) return;
  const r = editing.el.getBoundingClientRect();
  const h = bar.offsetHeight;
  const y = r.top - h - 10 >= 8 ? r.top - h - 10 : Math.min(r.bottom + 10, innerHeight - h - 8);
  bar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8))}px`;
  bar.style.top = `${y}px`;
}

$('.tbar').addEventListener('pointerdown', (e) => e.preventDefault()); // keep the text selection
$('.tbar').addEventListener('click', (e) => {
  const f = e.target.closest('[data-fmt]')?.dataset.fmt;
  if (!f || !editing) return;
  if (f === 'bold' || f === 'italic') document.execCommand(f);
  if (f === 'link') linkPrompt();
  if (f === 'done') finishEdit(true);
  if (f === 'cancel') finishEdit(false);
});

/** In a site, the pages to link to (a link between pages is written /<page>/, see site.ts). */
const pageHref = (p) => `/${p}/`;
function pagePicker() {
  if (!S.site?.pages.length) return '';
  return `<div class="linkpages" role="group" aria-label="${t('Pages of this site')}"><span>${t('Or a page of this site:')}</span>${S.site.pages.map((p) => `<button type="button" data-href="${esc(pageHref(p))}" ${p === S.site.current ? 'aria-current="page"' : ''}>${esc(p)}</button>`).join('')}</div>`;
}

/** Link the selected words, or change or remove the link the caret is in. */
function linkPrompt() {
  const sel = getSelection();
  if (!editing || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const a = start?.closest?.('a');
  const link = a && editing.el.contains(a) ? a : null;
  if (!link && range.collapsed) return toast(t('Select the words to link first.'));
  const r = range.getBoundingClientRect();
  popover(r.left, r.bottom + 8, `<label class="pop-field"><span>${t('Link to')}</span><input class="href" value="${esc(link?.getAttribute('href') ?? '')}" placeholder="${S.site ? 'https://…  #section  /page/' : 'https://…  #section  page.html'}" spellcheck="false"></label>
    ${pagePicker()}
    <div class="row">${link ? `<button data-l="unlink">${t('Remove link')}</button>` : ''}<button data-l="cancel">${t('Cancel')}</button><button data-l="ok" class="primary">${t('Link')}</button></div>`);
  const input = $('.pop .href');
  input.focus();
  const back = () => {
    closePop();
    if (!editing) return;
    editing.el.focus();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const apply = (how) => {
    const href = input.value.trim();
    if (how === 'ok' && href && !safeHref(href)) return toast(t('That link target is not allowed.'), true);
    back();
    if (how === 'cancel' || !editing) return;
    if (how === 'unlink' || !href) {
      if (!link) return;
      const all = document.createRange();
      all.selectNodeContents(link);
      sel.removeAllRanges();
      sel.addRange(all);
      document.execCommand('unlink');
    } else if (link) link.setAttribute('href', href);
    else document.execCommand('createLink', false, href);
  };
  pop.onclick = (e) => {
    const pg = e.target.closest('[data-href]');
    if (pg) return (input.value = pg.dataset.href), input.focus();
    const b = e.target.closest('[data-l]');
    if (b) apply(b.dataset.l);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') e.preventDefault(), apply('ok');
    if (e.key === 'Escape') e.preventDefault(), back();
  };
}

// ---------- editing in place: images ----------
// Double-click an image (or "Edit image…"): replace it, crop it, turn it and scale it down. A changed
// picture is saved as a new file in assets/ (the old one stays) and the code only changes its src
// (and alt, width and height when it has them), so no styles are added to the box.

const imgtool = $('.imgtool');
const fileInput = $('.imgfile');
let tool = null; // the image being edited, see openImageTool

const ASPECTS = [['free', null], ['original', null], ['page', null], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9]];
const MAXES = [0, 2400, 1600, 1200, 800];
const STAGE = { w: 320, h: 220 };
const aspectLabel = (k) => ({ free: t('Free'), original: t('Original'), page: t('As on the page') })[k] ?? k;

async function openImageTool(id, img) {
  if (editing) await finishEdit(true);
  closeMenu();
  closePop();
  const found = await codeFor(id, img, sameImage).catch(() => null);
  if (!found) {
    showPanel();
    select(id, { tab: 'text' });
    return toast(t('This image is changed by the box\'s script; change its address in the Text tab.'));
  }
  const src = img.getAttribute('src');
  const url = new URL(src, location.href);
  const boxEl = elOf(id);
  tool = {
    id, img, path: found.path, src, alt: img.getAttribute('alt') ?? '', remote: url.origin !== location.origin,
    // the image in assets/ the pixels come from: the image itself, or the original it was cropped from
    origin: isAssetPath(src) ? src : null, derived: false,
    file: null, picked: null, bitmap: null, type: null, quarter: 0, aspect: 'free', max: 0, crop: null,
    pageAspect: img.clientWidth && img.clientHeight ? img.clientWidth / img.clientHeight : null,
    // the image fills its box: the box's handles size it
    fillsBox: !!boxEl && img.getBoundingClientRect().width >= boxEl.getBoundingClientRect().width * 0.8,
  };
  if (!tool.remote) {
    try {
      // a crop made here keeps its original: open that, with the crop on it, so it can be widened again
      const { origin } = await api(`/asset/origin?src=${encodeURIComponent(src)}`).catch(() => ({ origin: null }));
      await loadPicture(await (await fetch(origin?.from ?? url)).blob());
      if (origin && tool.bitmap) Object.assign(tool, { origin: origin.from, derived: true, quarter: origin.quarter, max: origin.max, crop: origin.crop });
    } catch {
      tool.type = null;
    }
  }
  renderTool();
}

const isAssetPath = (src) => /^assets\/[A-Za-z0-9._-]+$/.test(src);

/** Take a picture into the tool: crop and turn work on raster images (not GIF, which may move, or SVG). */
async function loadPicture(blob) {
  tool.type = blob.type;
  tool.bitmap = /gif|svg/.test(blob.type) ? null : await createImageBitmap(blob).catch(() => null);
  tool.quarter = 0;
  resetCrop();
}

const turnedSize = () => turned(tool.bitmap.width, tool.bitmap.height, tool.quarter);
function aspectValue() {
  if (tool.aspect === 'free') return null;
  if (tool.aspect === 'original') return turnedSize().w / turnedSize().h;
  if (tool.aspect === 'page') return tool.pageAspect;
  return ASPECTS.find(([k]) => k === tool.aspect)[1];
}
function resetCrop() {
  if (!tool.bitmap) return (tool.crop = null);
  const { w, h } = turnedSize();
  tool.crop = fitAspect(w, h, aspectValue());
}

function renderTool() {
  const T = tool;
  const crop = !!T.bitmap;
  const shown = T.file ? URL.createObjectURL(T.file) : T.picked ?? T.src;
  const edges = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((c) => `<i data-c="${c}"></i>`).join('');
  imgtool.innerHTML = `
    <header><b>${t('Image')}</b><span class="muted">${esc(T.id)}</span></header>
    <div class="stage">${crop ? `<canvas class="view"></canvas><div class="crop">${edges}</div>` : `<img class="still" src="${esc(shown)}" alt="">`}</div>
    ${T.derived ? `<p class="note">${t('This image is a crop of an earlier one, shown whole here: drag the frame wider, or choose Original, to bring back what was cut.')}</p>` : ''}
    ${T.remote ? `<p class="note">${t('This image comes from another site. Copy it into the page to crop it; the page then stops loading it from there.')}</p><div class="row start"><button data-i="copy">${t('Copy into the page')}</button></div>`
      : !crop && T.type ? `<p class="note">${t('GIF and SVG images can be replaced, not cropped.')}</p>` : ''}
    ${crop ? `<div class="opts"><span class="lbl">${t('Shape')}</span>${ASPECTS.filter(([k]) => k !== 'page' || T.pageAspect).map(([k]) => `<button data-aspect="${k}" aria-pressed="${T.aspect === k}">${esc(aspectLabel(k))}</button>`).join('')}</div>
    <div class="opts"><span class="lbl">${t('Turn')}</span><button data-i="left" title="${t('Turn left')}">↺</button><button data-i="right" title="${t('Turn right')}">↻</button>
      <span class="lbl">${t('Largest side')}</span><select class="max">${MAXES.map((m) => `<option value="${m}" ${T.max === m ? 'selected' : ''}>${m ? `${m} px` : t('as it is')}</option>`).join('')}</select>
      <button data-i="reset" title="${t('The whole image, not turned, at its size')}">${t('Start over')}</button></div>
    <p class="hint size"></p>` : ''}
    <p class="hint">${T.fillsBox ? t('Its size on the page follows its box: drag the box handles on the page (its right edge makes it narrower, its bottom edge taller). Cropping changes its shape.') : t('Its size on the page comes from this box\'s layout. To size an image with the box handles, give it its own box with the Image component.')}</p>
    <label class="pop-field"><span>${t("Image text (for people who can't see it)")}</span><input class="alt" value="${esc(T.alt)}"></label>
    <div class="row start"><button data-i="file">${t('Choose a file…')}</button><button data-i="pick">${t('From this page…')}</button></div>
    <div class="picks" hidden></div>
    <div class="row"><button data-i="cancel">${t('Cancel')}</button><button data-i="apply" class="primary">${t('Apply')}</button></div>`;
  imgtool.hidden = false;
  placeTool();
  if (crop) drawStage();
}

function placeTool() {
  if (!tool || imgtool.hidden) return;
  const r = tool.img.isConnected ? tool.img.getBoundingClientRect() : null;
  const w = imgtool.offsetWidth, h = imgtool.offsetHeight;
  let x = (innerWidth - w) / 2;
  if (r && r.right + 12 + w <= innerWidth - 8) x = r.right + 12;
  else if (r && r.left - 12 - w >= 8) x = r.left - 12 - w;
  imgtool.style.left = `${Math.max(8, x)}px`;
  imgtool.style.top = `${Math.max(8, Math.min(r ? r.top : 40, innerHeight - h - 8))}px`;
}

/** Draw the picture turned by `quarter` quarter turns, its top-left corner at 0,0. */
function drawTurned(g, b, quarter) {
  const { w, h } = turned(b.width, b.height, quarter);
  g.translate(w / 2, h / 2);
  g.rotate((quarter * Math.PI) / 2);
  g.drawImage(b, -b.width / 2, -b.height / 2);
}

function drawStage() {
  const { w, h } = turnedSize();
  const s = Math.min(STAGE.w / w, STAGE.h / h, 1);
  tool.scale = s;
  const c = $('.imgtool canvas.view');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  g.scale(s, s);
  drawTurned(g, tool.bitmap, tool.quarter);
  placeCrop();
}

function placeCrop() {
  const s = tool.scale, r = tool.crop;
  const c = $('.imgtool canvas.view');
  Object.assign($('.imgtool .crop').style, { left: `${c.offsetLeft + r.x * s}px`, top: `${c.offsetTop + r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px` });
  const o = outputSize(r.w, r.h, tool.max || null);
  $('.imgtool .size').textContent = t('Result: {w} × {h} px', { w: o.w, h: o.h });
}

imgtool.addEventListener('pointerdown', (e) => {
  const box = e.target.closest('.crop');
  if (!box || !tool?.bitmap) return;
  e.preventDefault();
  const corner = e.target.dataset.c;
  const start = { x: e.clientX, y: e.clientY, r: { ...tool.crop } };
  const { w: W, h: H } = turnedSize();
  box.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = (ev.clientX - start.x) / tool.scale, dy = (ev.clientY - start.y) / tool.scale;
    tool.crop = corner ? resizeCrop(start.r, corner, dx, dy, aspectValue(), W, H) : moveCrop(start.r, dx, dy, W, H);
    placeCrop();
  };
  const end = () => {
    box.removeEventListener('pointermove', move);
    box.removeEventListener('pointerup', end);
    box.removeEventListener('lostpointercapture', end);
  };
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', end);
  box.addEventListener('lostpointercapture', end);
});

imgtool.addEventListener('click', async (e) => {
  if (!tool) return;
  const a = e.target.closest('[data-aspect]');
  if (a) {
    tool.aspect = a.dataset.aspect;
    resetCrop();
    return renderTool();
  }
  const pick = e.target.closest('[data-src]');
  if (pick) return choosePageImage(pick.dataset.src);
  const i = e.target.closest('[data-i]')?.dataset.i;
  if (i === 'left' || i === 'right') {
    tool.quarter = (tool.quarter + (i === 'right' ? 1 : 3)) % 4;
    resetCrop();
    return renderTool();
  }
  if (i === 'reset') {
    Object.assign(tool, { quarter: 0, aspect: 'free', max: 0 });
    resetCrop();
    return renderTool();
  }
  if (i === 'file') return fileInput.click();
  if (i === 'pick') return showPicks();
  if (i === 'copy') return copyIntoPage();
  if (i === 'cancel') return closeTool();
  if (i === 'apply') return applyTool();
});
imgtool.addEventListener('change', (e) => {
  if (!e.target.matches('select.max')) return;
  tool.max = +e.target.value;
  placeCrop();
});
imgtool.addEventListener('input', (e) => {
  if (e.target.matches('input.alt')) tool.alt = e.target.value;
});
imgtool.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') e.preventDefault(), closeTool();
  if (e.key === 'Enter' && e.target.matches('input.alt')) e.preventDefault(), applyTool();
});
imgtool.addEventListener('dragover', (e) => e.preventDefault());
imgtool.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) useFile(f);
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (f) useFile(f);
});

async function useFile(f) {
  if (!tool) return;
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(f.type)) return toast(t('Choose a PNG, JPEG, GIF, WebP or AVIF image.'), true);
  Object.assign(tool, { file: f, picked: null, remote: false, origin: null, derived: false });
  await loadPicture(f);
  renderTool();
}

async function choosePageImage(src) {
  Object.assign(tool, { file: null, picked: src, remote: false, origin: isAssetPath(src) ? src : null, derived: false });
  try {
    await loadPicture(await (await fetch(src)).blob());
  } catch {
    tool.bitmap = null;
  }
  renderTool();
}

async function showPicks() {
  const box = $('.imgtool .picks');
  const { images } = await api('/assets');
  if (!tool) return;
  box.hidden = false;
  box.innerHTML = images.length
    ? images.map((p) => `<button data-src="${esc(p)}" title="${esc(p)}"><img src="${esc(p)}" alt=""></button>`).join('')
    : `<p class="muted">${t('This page has no images yet.')}</p>`;
  placeTool();
}

async function copyIntoPage() {
  try {
    const { path } = await api('/asset/fetch', { url: new URL(tool.src, location.href).href });
    Object.assign(tool, { picked: path, remote: false, origin: path, derived: false });
    await loadPicture(await (await fetch(path)).blob());
    renderTool();
    toast(t('The image is now part of the page. Apply to use it.'));
  } catch (err) {
    toast(err.message, true);
  }
}

const base64 = (blob) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(blob);
});

async function applyTool() {
  const T = tool;
  if (!T) return;
  try {
    let src = T.picked ?? T.src, size = null;
    // an uploaded file is kept as it is, as the original of any crop made from it
    if (T.file) src = T.origin = (await api('/asset', { data: await base64(T.file) })).path;
    if (T.bitmap) {
      const { w, h } = turnedSize();
      const whole = T.crop.x < 0.5 && T.crop.y < 0.5 && Math.abs(T.crop.w - w) < 0.5 && Math.abs(T.crop.h - h) < 0.5;
      const out = outputSize(T.crop.w, T.crop.h, T.max || null);
      size = out;
      if (whole && !T.quarter && out.k === 1) src = T.origin ?? src; // the original as it is: also how a crop is undone
      else {
        const c = Object.assign(document.createElement('canvas'), { width: out.w, height: out.h });
        const g = c.getContext('2d');
        g.scale(out.k, out.k);
        g.translate(-T.crop.x, -T.crop.y);
        drawTurned(g, T.bitmap, T.quarter);
        // PNG keeps its transparency; photos become JPEG (every browser can write it)
        const blob = await new Promise((ok) => c.toBlob(ok, T.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85));
        const from = T.origin && { from: T.origin, crop: T.crop, quarter: T.quarter, max: T.max };
        src = (await api('/asset', { data: await base64(blob), ...(from ? { from } : {}) })).path;
      }
    }
    const box = await loadBox(T.id, true);
    const tpl = parseCode(box.html);
    const code = atPath(tpl.content, T.path);
    if (code?.nodeName !== 'IMG' || code.getAttribute('src') !== T.src) throw new Error(t('The box changed meanwhile, so the image was not changed.'));
    const before = tpl.innerHTML;
    code.setAttribute('src', src);
    if (T.alt.trim() || code.hasAttribute('alt')) code.setAttribute('alt', T.alt.trim());
    if (src !== T.src) {
      // a srcset (or <source> next to it) would keep showing the old picture
      code.removeAttribute('srcset');
      code.removeAttribute('sizes');
      if (code.parentElement?.nodeName === 'PICTURE') for (const s of code.parentElement.querySelectorAll('source')) s.remove();
      if (size) for (const [k, v] of [['width', size.w], ['height', size.h]]) if (code.hasAttribute(k)) code.setAttribute(k, String(v));
    }
    closeTool();
    if (tpl.innerHTML !== before) {
      await api('/box', { id: T.id, html: tpl.innerHTML });
      per(T.id).box = null;
      per(T.id).text = null;
      toast(t('Image saved'));
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function closeTool() {
  tool = null;
  imgtool.hidden = true;
  imgtool.innerHTML = '';
  afterInPlace();
}

// ---------- tasks on the page ----------
// In task mode a click anywhere on the page adds a task on that element: for later, for a colleague
// or for Kaity. A task keeps its block, the element inside it (its element path) and the window
// width it was written at (src/tasks.ts). Open tasks show as numbered tabs that follow their element.

const tasksBtn = $('.tasksbtn');
const taskBar = $('.taskbar');
const pinsEl = $('.pins');

/** The site kit as the panel needs it: the shared blocks (with the pages that show them) and the site's own tags. */
async function loadKit() {
  S.kit = await api('/kit').catch(() => S.kit);
  if (S.sel && info(S.sel)) renderWork();
}

async function loadTasks() {
  const r = await api('/tasks').catch(() => null);
  if (!r) return;
  S.tasks = r.tasks;
  S.tasksText = r.text;
  renderTasksCount();
  redraw();
}

const openTasks = () => S.tasks.filter((x) => !x.done);

function renderTasksCount() {
  const n = openTasks().length;
  const count = $('.count', tasksBtn);
  count.hidden = !n;
  count.textContent = n;
  $('.nb-say span', taskBar).textContent = n
    ? (n === 1 ? t('Click anything to add a task · 1 open') : t('Click anything to add a task · {n} open', { n }))
    : t('Click anything to add a task');
  $('[data-nb="pins"]', taskBar).setAttribute('aria-pressed', S.showPins);
}

/** The element a task is on, on the page now: its block, then the element inside it (the block itself when the element is gone). */
function taskEl(x) {
  const block = elOf(x.block);
  if (!block || !x.path?.length) return block;
  return atPath(block, x.path) ?? block;
}

/** An element in a few words, as the person sees it: its tag, then its first words or its picture's description. */
function describeEl(el) {
  const tag = el.nodeName.toLowerCase();
  const words = (el.nodeName === 'IMG' ? el.alt : el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return words ? `${tag} "${words.length > 40 ? `${words.slice(0, 39)}…` : words}"` : tag;
}

/** Where a task added on this element goes: the nearest block in the tree, and the element's place inside it. */
function taskSpot(el) {
  const block = blockAt(el);
  if (!block) return null;
  const blockEl = elOf(block);
  // an element the code doesn't count (inside a <script> or <template>, say) pins to the nearest one it does
  for (let x = el; x && x !== blockEl; x = x.parentElement) {
    const path = elementPath(x, blockEl);
    if (path) return { block, el: x, path, label: describeEl(x) };
  }
  return { block, el: blockEl, path: null, label: '' };
}

function drawTasks() {
  // the element under the pointer (or the one whose task is being written): outlined, with its place in words
  const nh = $('.nhover');
  // (the element a task is being written for shows outside task mode too: the context menu's Add a task for Kaity here…)
  const at = S.taskTarget ?? (S.taskMode ? S.taskAt : null);
  const ar = at?.el.isConnected ? at.el.getBoundingClientRect() : null;
  nh.style.display = ar ? 'block' : 'none';
  if (ar) {
    Object.assign(nh.style, { left: `${ar.left + scrollX}px`, top: `${ar.top + scrollY}px`, width: `${ar.width}px`, height: `${ar.height}px` });
    $('.tag', nh).textContent = at.label ? `${at.block} › ${at.label}` : at.block;
    nh.classList.toggle('tag-inside', ar.top + scrollY < 22);
  }
  // one tab per open task, on its element's top-right corner (sharp corner on the element; the outline's label keeps the
  // top left); tabs on the same element line up leftwards
  const show = S.showPins || S.taskMode;
  const shown = show ? openTasks().filter((x) => !x.gone) : [];
  const taken = new Map();
  pinsEl.innerHTML = shown.map((x) => {
    const el = taskEl(x);
    const r = el?.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return '';
    const i = taken.get(el) ?? 0;
    taken.set(el, i + 1);
    // above the element's top edge; inside it when there is no room above (the top of the page) or on a whole block
    const inside = !x.path?.length || r.top + scrollY < 24;
    const right = Math.min(r.right, innerWidth) + scrollX - i * 34, top = inside ? r.top + scrollY : r.top + scrollY - 20;
    return `<button class="pin${inside ? ' inside' : ''}" data-pin="${x.n}" style="left:${right}px;top:${top}px" title="${esc(x.text.length > 120 ? `${x.text.slice(0, 119)}…` : x.text)}" aria-label="${t('Task {n}', { n: x.n })}">${x.n}</button>`;
  }).join('');
}

// ---------- Kaity at work, on the page ----------
// While Kaity works, her block gets a live frame with her latest step, and each open task she has
// left in it pulses; a task she closes stops. On the whole page (a run from the top block) the label
// rides on the first task left, or sits at the top of the window.

const kwork = $('.kwork');
function drawKaity() {
  if (!S.ai || !info(S.ai.id)) return void (kwork.innerHTML = '');
  const id = S.ai.id, whole = id === S.tree.id;
  const inside = (b) => whole || b === id || ancestors(b).includes(id);
  const given = S.ai.tasks ? new Set(S.ai.tasks) : null;
  const left = openTasks().filter((x) => !x.gone && inside(x.block) && (!given || given.has(x.n)));
  const step = S.aiStep ? esc(S.aiStep.length > 90 ? `${S.aiStep.slice(0, 89)}…` : S.aiStep) : t('Kaity is working');
  const box = (r, cls, tag = '') => `<div class="${cls}" style="left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px">${tag}</div>`;
  const label = () => `<span class="ktag">${kaityMark(true)}<b>${esc(whole ? t('Kaity') : id)}</b><span>${step}</span></span>`;
  let html = '', labelled = false;
  const fr = whole ? null : elOf(id)?.getBoundingClientRect();
  if (fr && (fr.width || fr.height)) {
    html += box(fr, 'kframe', label());
    labelled = true;
  }
  for (const x of left) {
    const r = taskEl(x)?.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) continue;
    html += box(r, 'ktask', labelled ? '' : label());
    labelled = true;
  }
  if (!labelled) html += `<div class="kfloat" style="top:${scrollY + 12}px">${label()}</div>`;
  kwork.innerHTML = html;
}

function setTaskMode(v) {
  if (v && !S.on) setOn(true);
  if (v) finishEdit(true);
  S.taskMode = v;
  S.taskAt = S.taskTarget = null;
  tasksBtn.setAttribute('aria-pressed', v);
  taskBar.hidden = !v;
  host.classList.toggle('task-mode', v);
  document.documentElement.style.cursor = v ? 'crosshair' : '';
  closePop();
  renderTasksCount();
  redraw();
}
tasksBtn.addEventListener('click', () => setTaskMode(!S.taskMode));

const when = (iso) => new Date(iso).toLocaleString(LANG, { dateStyle: 'medium', timeStyle: 'short' });
const placeOf = (x) => `<b>${esc(x.block)}</b>${x.label ? ` › ${esc(x.label)}` : ''}`;

/** The form for a new task, next to where the person clicked; `forKaity` adds Add and give it to Kaity (the context menu's Add a task for Kaity here…). */
function openTaskForm(x, y, spot, { forKaity = false } = {}) {
  S.taskTarget = spot;
  redraw();
  const width = innerWidth;
  popover(x + 12, y + 12, `<div class="taskform">
    <div class="task-place">${ic('task')}<span>${placeOf(spot)}</span></div>
    <textarea rows="3" placeholder="${t('What should change here, or what do you want to ask?')}"></textarea>
    <div class="row"><span class="muted">${t('Seen {px} px wide', { px: width })}</span><span class="spacer"></span><button data-n="cancel">${t('Cancel')}</button>${forKaity
      ? `<button data-n="add">${t('Add task')}</button><button data-n="ask" class="primary" ${S.ai ? `disabled title="${t('Kaity is working on {id}', { id: esc(S.ai.id) })}"` : ''}>${kaityMark()}${t('Add and give it to Kaity')}</button>`
      : `<button data-n="add" class="primary">${t('Add task')}</button>`}</div>
  </div>`);
  const ta = $('.pop textarea');
  ta.focus();
  // how = cancel | add | ask (add, then Kaity works through the block's open tasks)
  const done = async (how) => {
    const text = ta.value.trim();
    if (how !== 'cancel' && !text) return ta.focus();
    closePop();
    S.taskTarget = null;
    redraw();
    if (how === 'cancel') return;
    try {
      const r = await api('/tasks/add', { block: spot.block, path: spot.path, label: spot.label, width, text });
      await loadTasks();
      if (how === 'ask') return askTasks(spot.block);
      toast(t('Task {n} added on {id}', { n: r.result.n, id: spot.block }));
    } catch (err) {
      toast(err.message, true);
    }
  };
  pop.onclick = (e) => {
    const b = e.target.closest('[data-n]');
    if (b && !b.disabled) done(b.dataset.n);
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(), done(forKaity && !S.ai ? 'ask' : 'add');
    if (e.key === 'Escape') e.preventDefault(), done('cancel');
  };
}

/** One task, from its tab or the list: what it says, and what to do with it. */
function openTask(n, x, y) {
  const task = S.tasks.find((z) => z.n === n);
  if (!task) return;
  const busy = !!S.ai;
  popover(x, y, `<div class="taskview">
    <div class="task-head"><span class="pin static">${task.n}</span><span class="task-place"><span>${placeOf(task)}</span></span></div>
    <p class="task-text">${esc(task.text)}</p>
    <p class="muted">${task.width ? t('Written {when}, {px} px wide', { when: esc(when(task.at)), px: task.width }) : t('Written {when}', { when: esc(when(task.at)) })}${task.gone ? ` · ${t('its block is gone')}` : ''}</p>
    ${task.done ? `<p class="task-reply">${ic('check')}<span>${task.done.reply ? esc(task.done.reply) : t('Done')}<br><span class="muted">${task.done.by === 'ai' ? t('Kaity, {when}', { when: esc(when(task.done.at)) }) : esc(when(task.done.at))}</span></span></p>` : ''}
    <div class="row">
      <button data-n="remove" class="danger">${t('Remove')}</button><span class="spacer"></span>
      ${task.done ? `<button data-n="reopen">${t('Open again')}</button>`
        : `${task.gone ? '' : `<button data-n="ask" ${busy ? 'disabled' : ''} title="${busy ? t('Kaity is working on {id}', { id: esc(S.ai.id) }) : t('Kaity works through the open tasks on {id}', { id: esc(task.block) })}">${kaityMark()}${t('Give it to Kaity')}</button>`}<button data-n="close" class="primary">${ic('check')}${t('Done')}</button>`}
    </div>
  </div>`);
  pop.onclick = async (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    closePop();
    try {
      if (b.dataset.n === 'ask') return askTasks(task.block);
      await api(`/tasks/${b.dataset.n}`, { n });
      await loadTasks();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

/** Kaity works through the open tasks on a block (and inside it), in that block's conversation. */
async function askTasks(block) {
  try {
    const r = await api('/tasks/ask', { id: block });
    S.ai = { id: block, tasks: r.result };
    if (S.taskMode) setTaskMode(false);
    select(block, { scroll: true, tab: 'ai' });
  } catch (err) {
    toast(err.message, true);
  }
}

/** Every task on the page, by block: the open ones, then the ones that are done. */
function openTaskList() {
  const open = openTasks(), done = S.tasks.filter((x) => x.done);
  const blocks = [...new Set(open.map((x) => x.block))];
  const row = (x) => `<li><button class="task-row" data-open="${x.n}"><span class="pin static${x.done ? ' done' : ''}">${x.n}</span><span><span class="task-place">${x.label ? esc(x.label) : esc(x.block)}</span><span class="task-text">${esc(x.text)}</span></span></button></li>`;
  const r = taskBar.getBoundingClientRect();
  const all = open.filter((x) => !x.gone).length;
  popover(r.left, r.top - 8, `<div class="tasklist">
    ${all > 1 ? `<button class="primary ask-all" data-ask="${esc(S.tree.id)}" ${S.ai ? 'disabled' : ''} title="${t('One run from the top block: Kaity works through every open task on the page')}">${kaityMark()}${t('Give Kaity every task ({n})', { n: all })}</button>` : ''}
    ${open.length ? blocks.map((b) => {
      const mine = open.filter((x) => x.block === b);
      const gone = mine[0].gone;
      return `<section><header><b>${esc(b)}</b>${gone ? `<span class="muted">${t('gone')}</span>` : `<button class="link" data-ask="${esc(b)}" ${S.ai ? 'disabled' : ''}>${kaityMark()}${mine.length === 1 ? t('Give it to Kaity') : t('Give Kaity these {n}', { n: mine.length })}</button>`}</header><ol>${mine.map(row).join('')}</ol></section>`;
    }).join('') : `<p class="muted">${t('No open tasks. Click anything on the page to add one.')}</p>`}
    <a class="handbook-link" href="${API}/handbook" target="_blank" rel="noopener">${ic('blocks')}<span>${t('Every task in the handbook, with the page\'s theme and blocks')}</span>${ic('right')}</a>
    ${done.length ? `<details><summary>${done.length === 1 ? t('1 task done') : t('{n} tasks done', { n: done.length })}</summary><ol>${done.map(row).join('')}</ol><div class="row"><button data-clear>${t('Remove the tasks that are done')}</button></div></details>` : ''}
  </div>`);
  // above the bar: the list grows upwards
  pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
  pop.onclick = async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) {
      const task = S.tasks.find((z) => z.n === +o.dataset.open);
      const el = task && !task.gone ? taskEl(task) : null;
      el?.scrollIntoView({ block: 'center', behavior: stillMotion ? 'auto' : 'smooth' });
      return setTimeout(() => openTask(+o.dataset.open, r.left, r.top - 8), el ? 350 : 0);
    }
    const a = e.target.closest('[data-ask]');
    if (a) return closePop(), askTasks(a.dataset.ask);
    if (e.target.closest('[data-clear]')) {
      closePop();
      await api('/tasks/clear', {}).catch((err) => toast(err.message, true));
      loadTasks();
    }
  };
}

async function copyTasks() {
  if (!S.tasksText) return toast(t('No open tasks to copy'), true);
  const name = S.site?.current ?? document.title;
  const text = `${t('Tasks on the page {name}, from the TYKERF editor. Each names the block, the element inside it and the window width it was written at:', { name })}\n${S.tasksText}\n`;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('Copied: paste them into any AI agent or a message'));
  } catch {
    toast(t('Could not copy to the clipboard'), true);
  }
}

taskBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nb]')?.dataset.nb;
  if (b === 'done') setTaskMode(false);
  if (b === 'list') openTaskList();
  if (b === 'copy') copyTasks();
  if (b === 'pins') {
    S.showPins = !S.showPins;
    store.set('pins', S.showPins);
    renderTasksCount();
    redraw();
  }
});
pinsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pin]');
  if (!b) return;
  const r = b.getBoundingClientRect();
  openTask(+b.dataset.pin, r.right + 6, r.top);
});

// ---------- context menu (right button) ----------

const menu = $('.menu');

let menuAt = null; // where the menu was opened and what was under the pointer: { x, y, text, img }

function openMenu(x, y, id, target = null) {
  const n = info(id).node;
  const item = (act, icon, label, extra = '') => `<button role="menuitem" data-act="${act}" ${extra}>${ic(icon)}${label}</button>`;
  const hasParent = !!parentOf(id);
  // what can be edited right where the pointer is
  const boxEl = n.kind === 'box' ? elOf(id) : null;
  const img = boxEl && target?.closest?.('img');
  const here = { x, y, img: img && boxEl.contains(img) ? img : null, text: null, target };
  if (boxEl && !here.img && target) here.text = editableAt(target, boxEl);
  menuAt = here;
  menu.innerHTML = `<div class="menu-title">${esc(id)} <span>${esc(kindLabel(n))}</span></div>` + [
    here.text ? item('edit-here', 'text', t('Edit this text')) : n.kind === 'box' ? item('tab', 'text', t('Edit text'), 'data-tab="text"') : '',
    here.img ? item('image-here', 'image', t('Edit image…')) : '',
    n.kind === 'box' ? item('tab', 'code', t('Edit code'), 'data-tab="code"') : '',
    item('tab', 'ai', t('Ask Kaity here…'), 'data-tab="ai"'),
    item('task-here', 'task', t('Add a task for Kaity here…')),
    n.kind === 'box' ? item('import', 'import', t('Import a section…')) : '',
    '<hr>',
    item('size', 'size', t('Sizes…')),
    item('rename-here', 'rename', t('Rename…')),
    S.buffer.length ? item('paste', 'paste', t('Paste…')) : '',
    '<hr>',
    hasParent ? item('insert', 'beside', t('Add box beside'), 'data-as="row"') : '',
    hasParent ? item('insert', 'below', t('Add box below'), 'data-as="column"') : '',
    n.kind === 'container' && /row|column/.test(n.arrangement) ? item('add-inside', 'inside', t('Add box inside')) + item('flip', 'flip', n.arrangement === 'row' ? t('Make column') : t('Make row')) : '',
    hasParent ? '<hr>' + item('parent', 'parent', t('Select {id}', { id: esc(parentOf(id)) })) : '',
    hasParent ? item('remove-here', 'delete', t('Delete…'), 'class="danger"') : '',
  ].join('');
  menu.hidden = false;
  menu.dataset.id = id;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(x, innerWidth - mw - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - mh - 8)}px`;
  menu.querySelector('button')?.focus();
}
const closeMenu = () => (menu.hidden = true);

menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = menu.dataset.id;
  closeMenu();
  if (b.dataset.act !== 'tab' && S.sel !== id) select(id);
  // small actions happen on the page, next to the block; the rest opens the panel
  const here = menuAt ?? { x: 0, y: 0 };
  if (b.dataset.act === 'edit-here') return startTextEdit(id, here.text);
  if (b.dataset.act === 'image-here') return openImageTool(id, here.img);
  if (b.dataset.act === 'rename-here') return renameHere(id, here.x, here.y);
  if (b.dataset.act === 'task-here') {
    const spot = (here.target && taskSpot(here.target)) || { block: id, el: elOf(id), path: null, label: '' };
    return openTaskForm(here.x, here.y, spot, { forKaity: true });
  }
  if (b.dataset.act === 'remove-here') return removeHere(id, here.x, here.y);
  act(b.dataset.act, id, b.dataset);
  if (b.dataset.act === 'tab') setTimeout(() => $('.work .tab-body textarea')?.focus(), 150);
});
menu.addEventListener('keydown', (e) => {
  const items = [...menu.querySelectorAll('button')];
  const i = items.indexOf(ui.activeElement);
  if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
  if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
  if (e.key === 'Escape') closeMenu();
});

// ---------- the page under the layer ----------

const fromUI = (e) => e.composedPath().includes(host);

/** The block at an element: the nearest rendered block that is in the tree. */
function blockAt(el) {
  for (let x = el?.closest?.('[data-sw]'); x; x = x.parentElement?.closest('[data-sw]')) if (info(x.dataset.sw)) return x.dataset.sw;
  return null;
}
const boxAt = (el) => {
  const id = blockAt(el);
  return id && isBox(id) ? id : null;
};

addEventListener('pointermove', (e) => {
  if (!S.on || fromUI(e)) return;
  if (S.taskMode) {
    const spot = S.taskTarget ? null : taskSpot(e.target);
    if (spot?.el !== S.taskAt?.el) {
      S.taskAt = spot;
      redraw();
    }
    return;
  }
  const id = boxAt(e.target);
  if (id !== S.hover) {
    S.hover = id;
    redraw();
  }
}, true);
document.documentElement.addEventListener('mouseleave', () => {
  S.hover = null;
  redraw();
});

// While the layer is on, the page is for pointing: links, buttons and forms don't react.
for (const type of ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit', 'contextmenu']) {
  addEventListener(type, (e) => {
    const path = e.composedPath();
    if (type === 'pointerdown' && !path.includes(pop)) closePop();
    if (!S.on || fromUI(e)) {
      if (type === 'pointerdown' && !path.includes(menu)) closeMenu();
      return;
    }
    // the text being edited works like text (caret, selection, the browser's own menu); its links don't navigate
    if (editing && path.includes(editing.el)) {
      e.stopImmediatePropagation();
      if (type === 'click' || type === 'auxclick' || type === 'submit') e.preventDefault();
      return;
    }
    if (editing && type === 'pointerdown') finishEdit(true);
    e.preventDefault();
    e.stopImmediatePropagation();
    // task mode: a click adds a task where it lands; nothing else happens on the page
    if (S.taskMode) {
      const spot = type === 'click' && e.button === 0 && taskSpot(e.target);
      if (spot) openTaskForm(e.clientX, e.clientY, spot);
      return;
    }
    if (type === 'click' && e.button === 0) {
      closeMenu();
      const id = boxAt(e.target) ?? blockAt(e.target);
      if (id) select(id);
    }
    if (type === 'dblclick') {
      const id = boxAt(e.target);
      const boxEl = id && elOf(id);
      if (!boxEl) return;
      const img = e.target.closest?.('img');
      if (img && boxEl.contains(img)) return openImageTool(id, img);
      const el = editableAt(e.target, boxEl);
      if (el) return startTextEdit(id, el, { x: e.clientX, y: e.clientY });
      if (e.target.textContent?.trim()) textTabFor(id, e.target);
    }
    if (type === 'contextmenu') {
      const id = boxAt(e.target) ?? blockAt(e.target);
      if (!id) return;
      select(id);
      openMenu(e.clientX, e.clientY, id, e.target);
    }
  }, true);
}

const typing = () => {
  const a = ui.activeElement ?? document.activeElement;
  return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable);
};

addEventListener('keydown', (e) => {
  if (!S.on) return;
  if (e.key === 'Escape' && !menu.hidden) return closeMenu();
  if (e.key === 'Escape' && !pop.hidden) return closePop();
  if (typing()) return;
  if (e.key === 'Escape' && S.taskMode) return setTaskMode(false);
  if (e.key === 'Escape' && S.sel && parentOf(S.sel)) {
    e.preventDefault();
    select(parentOf(S.sel), { scroll: true });
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  // ⇧⌘Z (Mac) or Ctrl+Y / Ctrl+Shift+Z (Windows, Linux)
  if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || (e.key.toLowerCase() === 'y' && !e.metaKey))) {
    e.preventDefault();
    redo();
  }
}, true);

// ---------- panel: drag, collapse, toggle ----------

let panelPos = store.get('panel', null);

function keepPanelOnScreen() {
  const r = panel.getBoundingClientRect();
  const x = Math.max(8, Math.min(panelPos?.x ?? innerWidth - r.width - 24, innerWidth - r.width - 8));
  const y = Math.max(8, Math.min(panelPos?.y ?? (innerWidth < 700 ? innerHeight - r.height - 8 : 24), innerHeight - Math.min(r.height, 48) - 8));
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
}

$('.head').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.button !== 0) return;
  // a drag is not a text selection: without this, dragging past the window's edge selects the whole page
  e.preventDefault();
  getSelection()?.removeAllRanges();
  const head = e.currentTarget;
  // the header keeps the pointer even outside the window, so the drag always ends where it should
  head.setPointerCapture(e.pointerId);
  const r = panel.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  panel.classList.add('dragging');
  const move = (ev) => {
    panelPos = { x: ev.clientX - dx, y: ev.clientY - dy };
    keepPanelOnScreen();
  };
  const end = () => {
    panel.classList.remove('dragging');
    head.removeEventListener('pointermove', move);
    head.removeEventListener('pointerup', end);
    head.removeEventListener('lostpointercapture', end);
    store.set('panel', panelPos);
  };
  head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', end);
  head.addEventListener('lostpointercapture', end);
});

// remember the size the user gives the panel (CSS resize handle)
new ResizeObserver(() => {
  if (S.min || !S.on) return;
  store.set('size', { w: panel.offsetWidth, h: panel.offsetHeight });
}).observe(panel);
const size = store.get('size', null);
if (size) Object.assign(panel.style, { width: `${size.w}px`, height: `${size.h}px` });

function showPanel() {
  if (S.min) setMin(false);
}
function setMin(v) {
  S.min = v;
  store.set('min', v);
  panel.classList.toggle('min', v);
  $('.minimize').textContent = v ? '+' : '–';
  keepPanelOnScreen();
}
$('.minimize').addEventListener('click', () => setMin(!S.min));

$('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  S.view = b.dataset.view;
  store.set('view', S.view);
  renderView();
  redraw();
});
const renderView = () => {
  for (const b of $('.seg').children) b.setAttribute('aria-checked', b.dataset.view === S.view);
};

async function undo() {
  try {
    const r = await api('/undo', {});
    if (r.focus) pendingSelect = r.focus;
    toast(t('Undone: {change}', { change: r.undone }));
  } catch (err) {
    toast(err.message, true);
  }
}
$('.undo').addEventListener('click', undo);

async function redo() {
  try {
    const r = await api('/redo', {});
    if (r.focus) pendingSelect = r.focus;
    toast(t('Redone: {change}', { change: r.redone }));
  } catch (err) {
    toast(err.message, true);
  }
}
$('.redo').addEventListener('click', redo);

const toggle = $('.toggle');
function setOn(v) {
  S.on = v;
  store.set('on', v);
  toggle.setAttribute('aria-pressed', v);
  toggle.querySelector('span').textContent = v ? t('Back to the page') : t('Edit with TYKERF');
  panel.hidden = !v;
  if (!v) {
    if (S.taskMode) setTaskMode(false);
    finishEdit(true);
    closePop();
    if (tool) closeTool();
    closeMenu();
    S.hover = null;
  } else {
    setMin(S.min);
    select(S.sel && info(S.sel) ? S.sel : S.tree.id);
  }
  redraw();
}
toggle.addEventListener('click', () => setOn(!S.on));

let toastTimer;
function toast(text, error = false) {
  const el = $('.toast');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 6000 : 2500);
}

// ---------- an editor older than its code ----------
// The browser part is read fresh from disk, the server keeps the code it started with: when that code
// changed (or the server is too old to know /_tykerf/version), new buttons may lead nowhere, so say so.

const outdated = $('.outdated');
outdated.querySelector('button').onclick = () => (outdated.hidden = true);
async function checkVersion() {
  const r = await fetch('/_tykerf/version').catch(() => null);
  if (!r || r.status === 401) return; // offline, or a visitor
  outdated.hidden = !(r.status === 404 || (await r.json().catch(() => ({}))).outdated);
}
checkVersion();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkVersion());

// ---------- sync with the server ----------

let pendingSelect = null; // a block to select once the next re-render brings it in

let headVersion = null;
async function loadState() {
  const st = await api('/state');
  if (headVersion !== null && st.head !== headVersion) {
    // the page head (theme, fonts) can't be swapped in place: reload, and come back to the same block and tab
    try { sessionStorage.setItem('tykerf.resume', JSON.stringify({ sel: S.sel, tab: S.sel && per(S.sel).tab })); } catch {}
    location.reload();
    return new Promise(() => {}); // never resolves: the page is going away
  }
  headVersion = st.head;
  S.site = st.site;
  S.aiRunner = st.aiRunner ?? null;
  renderSwitcher();
  // the AI renamed the block it works on: the selection, its tab and drafts follow the block
  if (S.ai && st.ai && st.ai.id !== S.ai.id) {
    if (S.per.has(S.ai.id) && !S.per.has(st.ai.id)) S.per.set(st.ai.id, S.per.get(S.ai.id));
    if (S.sel === S.ai.id) pendingSelect = st.ai.id;
  }
  S.tree = st.tree;
  S.ai = st.ai;
  S.build = st.build ?? null;
  S.canUndo = st.canUndo;
  S.buffer = st.buffer ?? [];
  S.lastChange = st.lastChange;
  S.nextRedo = st.nextRedo;
  index(st.tree);
  const u = $('.undo');
  u.disabled = !st.canUndo;
  u.title = st.lastChange ? t('Undo: {change} (⌘Z)', { change: st.lastChange }) : t('Nothing to undo');
  const rd = $('.redo');
  rd.disabled = !st.nextRedo;
  rd.title = st.nextRedo ? t('Redo: {change} (⇧⌘Z)', { change: st.nextRedo }) : t('Nothing to redo');
}

/** Re-render the page from the tree in place (styles, markup, then box scripts run again). */
async function reloadPage() {
  const { css, body } = await api('/page');
  document.getElementById('sw--style').textContent = css;
  const pg = page();
  pg.innerHTML = body;
  for (const old of pg.querySelectorAll('script')) {
    const s = document.createElement('script');
    for (const a of old.attributes) s.setAttribute(a.name, a.value);
    s.textContent = old.textContent;
    old.replaceWith(s);
  }
  // the site's behaviours (kit/scripts) run on the new elements
  document.dispatchEvent(new Event('tykerf:render'));
}

async function refresh() {
  // the page can't be re-rendered under text being typed or an image being cropped: it waits for them
  if (editing || tool) return void (deferred = true);
  const started = S.sel;
  const prev = S.sel ? [S.sel, ...ancestors(S.sel).reverse()] : [];
  await Promise.all([loadState(), reloadPage()]);
  refocus();
  // drafts survive; cached box code is reloaded
  for (const p of S.per.values()) p.box = null;
  // a block the user selected while this refresh was loading wins over the one selected before it
  const chosen = S.sel !== started ? [S.sel] : [];
  const keep = [pendingSelect, ...chosen, ...prev].find((id) => id && info(id)) ?? S.tree.id;
  pendingSelect = null;
  if (!S.on) S.sel = keep;
  else if (keep === S.sel && typing()) {
    // don't pull the text field out from under the user's cursor
    renderPath();
    renderTree();
    redraw();
  } else select(keep);
}

const events = new EventSource(`${API}/events`);
events.addEventListener('changed', () => refresh().catch((e) => toast(e.message, true)));
// the page was renamed or removed (maybe from another tab): go where it went
events.addEventListener('moved', (e) => location.replace(JSON.parse(e.data).url));
events.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
events.addEventListener('tasks', () => loadTasks());
events.addEventListener('ai', (e) => {
  const m = JSON.parse(e.data);
  if (m.role === 'start') S.ai = { id: m.id, ...(m.tasks ? { tasks: m.tasks } : {}) };
  if (m.role === 'end') S.ai = null;
  // her latest step rides on the frame around her block (drawKaity)
  if (m.role === 'start' || m.role === 'end') S.aiStep = null;
  if (m.role === 'step' && m.text) S.aiStep = m.text.replace(/^refused: /, '');
  if (['start', 'end', 'step'].includes(m.role)) redraw();
  if (m.role === 'start' || m.role === 'end') renderTree(); // her balls on the block she works on
  if (m.role === 'end' && m.id !== S.sel) toast(t('Kaity finished on {id}', { id: m.id }));
  if (S.sel && per(S.sel).tab === 'ai' && (m.id === S.sel || m.role === 'start' || m.role === 'end')) renderAI($('.work .tab-body'), S.sel);
});

await loadState();
applyFocus();
S.sel = S.tree.id;
try {
  const resume = JSON.parse(sessionStorage.getItem('tykerf.resume') ?? 'null');
  sessionStorage.removeItem('tykerf.resume');
  if (resume?.sel && info(resume.sel)) {
    S.sel = resume.sel;
    if (resume.tab) per(resume.sel).tab = resume.tab;
  }
} catch {}
// ?block=<name>&tab=<tab> (from the site manager: where Kaity works, where a link is): open on that block and tab
const asked = new URLSearchParams(location.search);
if (asked.has('block')) {
  const id = asked.get('block');
  if (info(id)) {
    S.sel = id;
    if (['text', 'code', 'size', 'ai', 'blocks', 'page'].includes(asked.get('tab'))) per(id).tab = asked.get('tab');
    for (const a of ancestors(id)) S.open.add(a);
    S.on = true;
  }
  history.replaceState(null, '', location.pathname + location.hash);
}
renderView();
panel.hidden = true;
setOn(S.on);
keepPanelOnScreen();
// a page that is still being made (the AI building it, a copy) opens with its progress
api('/job').then((j) => renderJob(j.job)).catch(() => {});
loadTasks();
loadKit();
window.TYKERF = S; // for debugging from the console
