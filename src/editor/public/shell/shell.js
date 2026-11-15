// The v3 editor (shell.html at /_tykerf/edit/<page>/): one bar on top and the page below it in a frame, at its
// real width. Leaving tasks is the normal way to work: click anything on the page, say what should change, and
// hand the tasks to Kaity. She works through them one at a time (task-run.ts); the tray (from the top) shows each
// task as she goes, then the review: what she changed, before and after, undo one, answer what she asks.
// Everything tykerf draws over the page (outlines, pins, the task box) is in the shell's own document, over the
// frame; the page itself is untouched.

import { $, CHEVRON, MARK, esc, failed, kaityMark, plainLabel, request, shrinkImage, stillMotion, store, t, toast, watchVersion } from './common.js';
import { createFixPanel } from './fix.js';
import { createFrame } from './frame.js';
import { createSidebar } from './site.js';
import { atPath } from '../inline.js';
import { markdown } from '../markdown.js';

const PAGE = decodeURIComponent(location.pathname.match(/^\/_tykerf\/edit\/([^/]+)\//)?.[1] ?? '');
const API = `/${encodeURIComponent(PAGE)}/_tykerf`;
// the shell's two modes: Tasks (the page to point at, tasks, Kaity, fixing by hand) and the Full editor (?mode=full: the
// full editor in the frame, every block in detail); the bar, the site and Hide tykerf are the same in both
const FULL = new URLSearchParams(location.search).get('mode') === 'full';
const shellOf = (page, full = FULL) => `/_tykerf/edit/${encodeURIComponent(page)}/${full ? '?mode=full' : ''}`;
for (const el of document.querySelectorAll('[aria-label]')) el.setAttribute('aria-label', t(el.getAttribute('aria-label')));
$('.frame').title = t('The page');

const api = (path, body) => request(API + path, body);

// ---------- state ----------

const S = {
  blocks: new Set(), // the page's block names (the tree), so a click finds its block
  tree: null, // the page's tree of blocks (page.ts panelTree)
  kit: null, // the site kit's view (/_tykerf/site/kit), for "the same on another page"
  mode: store.get('sidebarMode', 'over'), // a sidebar over the page, or the page shrunk to fit beside it
  site: null, // { pages, current }
  head: null, // the page head's version: a change reloads the frame
  canUndo: false,
  lastChange: null,
  tasks: [], // every task of the page, done ones too
  next: 1, // the number the next task gets
  tasksText: '',
  run: null, // Kaity going through tasks (task-run.ts)
  job: null, // the page's job: Kaity building a new page, or a copy of a website being made (page.ts)
  hover: null, // { block, path, el, label } under the pointer
  box: null, // the task being written: { block, path, label, draft, question, touched }
  tray: false,
  stepsHidden: false, // the person closed the tray while Kaity works: it doesn't open again by itself
  lit: null, // the task card to light up in the tray
  more: null, // the card whose "Ask for more" field is open: { n, draft }
  answers: {}, // drafts of answers to Kaity's questions, by task
  device: 'full', // the page's width: full, a tablet held upright (768 px) or a phone (375 px); the bar switches it
  trying: null, // the task whose result is being tried on the page (Try the button)
  followed: null, // the task Kaity was last followed to
  scrolledAt: 0, // when the person last scrolled the page themselves
  undoAllAfterStop: false,
};
const openTasks = () => S.tasks.filter((x) => !x.done && !x.gone);
const running = () => !!S.run?.running;
const taskOf = (n) => S.tasks.find((x) => x.n === n);
/** The tasks of Kaity's run that the review still shows. */
const runTasks = () => (S.run?.tasks ?? []).filter((x) => !x.seen);

const labelTag = (label) => /^([a-z0-9-]+)/.exec(label ?? '')?.[1] ?? '';

// ---------- the frame ----------

const frame = createFrame($('.frame'), {
  isBlock: (id) => S.blocks.has(id),
  passive: () => FULL,
  on: {
    hover(spot) {
      if (spot?.el === S.hover?.el) return;
      S.hover = spot;
      draw();
    },
    pick(spot) {
      if (!ctxMenu.hidden) return closeCtx();
      // fixing by hand: a click picks the next thing to fix
      if (fix.isOpen()) return void fix.open(spot);
      // a task being written stays where it is; an empty one moves to what was clicked
      if (S.box?.draft.trim()) return void $('.taskbox textarea')?.focus();
      openBox(spot);
    },
    // two clicks on words: edit them in place (the first click's task box goes, while nothing is written in it)
    dblpick(spot) {
      const el = frame.taskEl(spot.block, spot.path);
      if (!spot.path || !textOnly(el) || S.trying) return;
      if (S.box?.draft.trim()) return;
      closeBox();
      editInPlace(spot, el);
    },
    moved: () => draw(),
    menu: (spot, x, y) => openMenu(spot, x, y),
    key: (e) => keys(e),
    scrolled: () => (S.scrolledAt = Date.now()),
    leads: (href) => toast(t('It leads to {href}', { href })),
    loaded() {
      S.hover = null;
      draw();
      arrive();
    },
  },
});
/** The page in the frame: as it is (Tasks), or with the full editor, on the block and tab the address asks for. */
const firstAsk = new URLSearchParams(location.search);
function frameSrc() {
  if (!FULL) return `/${encodeURIComponent(PAGE)}/?tykerf=frame`;
  const block = firstAsk.get('block'), tab = firstAsk.get('tab');
  firstAsk.delete('block');
  return `/${encodeURIComponent(PAGE)}/?tykerf=full-frame${block ? `&block=${encodeURIComponent(block)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}` : ''}`;
}
if (FULL && (firstAsk.has('block') || firstAsk.has('tab'))) window.history.replaceState(null, '', shellOf(PAGE));
/** The full editor (the expert way: every block in detail), on a block when one is given, at that tab ('': the block's own). */
const fullEditor = (block, tab = 'text') => `${shellOf(PAGE, true)}${block ? `&block=${encodeURIComponent(block)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}` : ''}`;

// ---------- what tykerf draws over the page: outlines, pins, Kaity, the task box ----------

const overlay = $('.overlay');
const trayHeight = () => (S.tray ? $('.tray').offsetHeight : 0);
const outline = (r, cls) => `<div class="outline ${cls}" style="left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px"></div>`;

function draw() {
  // the full editor draws its own outlines and pins in the page
  if (FULL) return void (overlay.innerHTML = '');
  const out = [];
  const target = S.box ? frame.taskEl(S.box.block, S.box.path) : null;
  const tr = frame.rect(target);
  if (tr) out.push(outline(tr, 'target'));
  // fixing by hand: the box chosen in the tree, or the element being fixed
  const fixing = fix?.isOpen() && fix.target ? frame.rect(frame.taskEl(fix.target.block, fix.target.path)) : null;
  if (fixing && !tr) out.push(outline(fixing, 'target'));
  const hr = !S.box && !S.trying ? frame.rect(S.hover?.el) : null;
  if (hr) out.push(outline(hr, 'hover'));
  // where Kaity is: the element of the task she works on now
  const now = S.run?.running ? S.run.tasks.find((x) => x.state === 'now') : null;
  const nowTask = now && taskOf(now.n);
  const nr = nowTask ? frame.rect(frame.taskEl(nowTask.block, nowTask.path)) : null;
  if (nr) {
    out.push(outline(nr, 'kaity'));
    // on the outline's top-left corner, above the element (inside it at the top of the page): never over the page's content beside it
    const left = Math.max(4, Math.min(nr.left - 3, frame.width - 150)), top = nr.top >= 30 ? nr.top - 30 : nr.top + 4;
    out.push(`<span class="ktag" style="left:${left}px;top:${top}px">${esc(t('{n} · Kaity is here', { n: now.question ? '?' : now.n }))}</span>`);
  }
  // pins: one per open task, and "done" on the tasks Kaity finished in this run; on one element they line up leftwards
  const pins = [
    ...openTasks().filter((x) => x.n !== now?.n).map((x) => ({ x, kind: x.kind === 'question' ? 'question' : '' })),
    ...runTasks().filter((r) => r.state === 'done' && !r.undone).map((r) => ({ x: taskOf(r.n), kind: 'done' })).filter((p) => p.x),
  ];
  const taken = new Map();
  for (const { x, kind } of pins) {
    const el = frame.taskEl(x.block, x.path);
    const r = frame.rect(el);
    if (!r) continue;
    const i = taken.get(el) ?? 0;
    taken.set(el, i + 1);
    const inside = !x.path?.length || r.top < 24;
    const shown = kind === 'done' ? t('{n} done', { n: x.n }) : kind === 'question' ? '?' : String(x.n);
    const left = Math.min(r.right, frame.width - 30 - (kind === 'done' ? 40 : 0)) - i * 34, top = inside ? r.top + 2 : r.top - 24;
    const name = kind === 'done' ? t('Task {n}, done: {text}', { n: x.n, text: x.text }) : kind === 'question' ? t('Question {n}: {text}', { n: x.n, text: x.text }) : t('Task {n}: {text}', { n: x.n, text: x.text });
    out.push(`<button class="pin ${kind}" data-pin="${x.n}" style="left:${left}px;top:${top}px" title="${esc(name)}" aria-label="${esc(name)}">${esc(shown)}</button>`);
  }
  overlay.innerHTML = out.join('');
  const tb = $('.taskbox');
  if (tb && tr) placeBox(tb, tr);
}

overlay.addEventListener('click', (e) => {
  const pin = e.target.closest('[data-pin]');
  if (pin) openTray(Number(pin.dataset.pin));
});

/** Kaity moved to another task: the page scrolls to it, unless the person scrolled it themselves a moment ago. */
function followKaity() {
  const now = S.run?.running ? S.run.tasks.find((x) => x.state === 'now') : null;
  if (!now || now.n === S.followed) return;
  S.followed = now.n;
  const x = taskOf(now.n);
  const el = x && frame.taskEl(x.block, x.path);
  if (el && Date.now() - S.scrolledAt > 6000) frame.show(el, trayHeight());
}

// ---------- the task box: what should change here, or a question ----------

function openBox(spot) {
  // fresh: a box just added, empty (nothing to point at on the page: the task box sits by the box it came from, `near`)
  S.box = { block: spot.block, path: spot.path, label: spot.label, draft: '', question: !!spot.question, touched: !!spot.question, images: [], fresh: !!spot.fresh, near: spot.near ?? null };
  renderBox();
  draw();
  $('.taskbox textarea').focus();
}

function closeBox() {
  S.box = null;
  $('.taskbox')?.remove();
  draw();
}

function renderBox() {
  const b = S.box;
  let el = $('.taskbox');
  if (!el) {
    el = document.createElement('div');
    el.className = 'taskbox';
    el.setAttribute('role', 'dialog');
    $('.viewport').append(el);
  }
  el.setAttribute('aria-label', t('A task for {what}', { what: plainLabel(b.label) }));
  const isQ = b.question;
  // one line: the number (a click makes it a question, or a task again), the box and the element, × to cancel;
  // the width only when the page isn't at its own (the bar's width buttons say it otherwise)
  const narrow = S.device !== 'full' ? `<span class="chip">${esc(t('{w} px', { w: frame.width }))}</span>` : '';
  const numTitle = isQ ? t('A question: Kaity answers it and changes nothing. Click to make it a task.') : t('Click to make it a question: Kaity answers it and changes nothing.');
  el.innerHTML = `
    <p class="where"><button type="button" class="num${isQ ? ' q' : ''}" data-box="q" aria-pressed="${isQ}" title="${esc(numTitle)}" aria-label="${esc(numTitle)}">${isQ ? esc(t('Question')) : S.next}</button><b title="${esc(t('Kaity changes only {block} for it.', { block: b.block }))}">${esc(b.block)}</b>${b.label ? `<span class="what">› ${esc(plainLabel(b.label))}</span>` : ''}${narrow}<button type="button" class="x" data-box="cancel" aria-label="${esc(t('Cancel'))}" title="${esc(t('Cancel (Esc)'))}">×</button></p>
    <div class="field">
      <textarea id="task-text" rows="2" aria-label="${esc(t('The task'))}" placeholder="${esc(b.fresh ? t('What should go in this new box? Kaity fills it, or leave it empty.') : t('What should change here? End with ? to ask.'))}">${esc(b.draft)}</textarea>
      ${b.images.length >= 5 ? '' : `<button type="button" class="addpic" data-box="pic" aria-label="${esc(t('Add a picture'))}" title="${esc(t('Add a picture: a screenshot, a sketch or a design to follow (up to 5; you can also paste or drop them here)'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg></button>`}
    </div>
    ${b.images.length ? `<div class="pics">${b.images.map((im, i) => `<span class="thumb"><img src="data:${im.mediaType};base64,${im.data}" alt="${esc(t('Picture {n}', { n: i + 1 }))}"><button type="button" data-unpic="${i}" aria-label="${esc(t('Remove picture {n}', { n: i + 1 }))}">×</button></span>`).join('')}</div>` : ''}
    <div class="row">
      <button type="button" class="link more" data-box="menu" aria-haspopup="menu" title="${esc(t('Fix it by hand, edit its words, add or delete boxes… (the same as a right-click on the page)'))}">${esc(t('More…'))} <span class="hint">${esc(t('or right-click'))}</span></button>
      <button type="button" class="btn" data-box="now">${esc(isQ ? t('Kaity, answer it now') : t('Kaity, do it now'))}</button>
      <button type="button" class="btn primary" data-box="add" title="${esc(t('⌘↵ / Ctrl+↵'))}">${esc(isQ ? t('Add question') : t('Add task'))}</button>
    </div>`;
  const ta = $('textarea', el);
  ta.oninput = () => {
    b.draft = ta.value;
    // a question mark at the end suggests a question, until the person sets it themselves
    if (!b.touched && /\?\s*$/.test(ta.value) !== b.question) {
      b.question = !b.question;
      const at = ta.selectionStart;
      renderBox();
      const again = $('.taskbox textarea');
      again.focus();
      again.setSelectionRange(at, at);
    }
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), addTask(false));
    if (e.key === 'Escape') (e.preventDefault(), closeBox());
  };
  ta.onpaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) (e.preventDefault(), attachPictures(files));
  };
  el.ondragover = (e) => (e.preventDefault(), el.classList.add('drop'));
  el.ondragleave = () => el.classList.remove('drop');
  el.ondrop = (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    attachPictures([...(e.dataTransfer?.files ?? [])]);
  };
  el.onclick = (e) => {
    const act = e.target.closest('[data-box]')?.dataset.box;
    if (act === 'cancel') closeBox();
    if (act === 'menu') {
      const r = e.target.closest('[data-box]').getBoundingClientRect();
      return openMenu({ block: b.block, path: b.path, label: b.label }, 0, 0, { at: { x: r.left, y: r.bottom + 4, above: r.top - 4 } });
    }
    if (act === 'q') {
      b.touched = true;
      b.question = !b.question;
      return keepTyping();
    }
    if (act === 'add') addTask(false);
    if (act === 'now') addTask(true);
    if (act === 'pic') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true });
      input.onchange = () => attachPictures([...input.files]);
      return input.click();
    }
    const un = e.target.closest('[data-unpic]');
    if (un) {
      b.images.splice(Number(un.dataset.unpic), 1);
      return keepTyping();
    }
  };
  const r = frame.rect(frame.taskEl(b.block, b.path)) ?? (b.near ? frame.rect(frame.blockEl(b.near)) : null);
  if (r) placeBox(el, r);
}

/** Redraw the box, keeping the place in what is being typed. */
function keepTyping() {
  const at = $('.taskbox textarea')?.selectionStart ?? S.box.draft.length;
  renderBox();
  const ta = $('.taskbox textarea');
  ta.focus();
  ta.setSelectionRange(at, at);
}

/** Pictures for the task (pick, paste or drop): at most five, scaled down as Kaity's are. */
async function attachPictures(files) {
  const b = S.box;
  if (!b) return;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (b.images.length >= 5) {
      toast(t('At most 5 pictures per task'), true);
      break;
    }
    try {
      b.images.push(await shrinkImage(f));
    } catch (err) {
      failed(err);
    }
  }
  if (S.box === b) keepTyping();
}

/** Below the element when there is room, else above it, inside the page's viewport. */
function placeBox(el, r) {
  const vp = $('.viewport');
  // the page shrunk to fit beside a panel: the task box is drawn back at its own size (it is read, not the page),
  // so it takes 1/zoom of the page's room
  const k = S.zoom && S.zoom < 0.999 ? S.zoom : 1;
  Object.assign(el.style, { transform: k < 1 ? `scale(${1 / k})` : '', transformOrigin: '0 0' });
  const W = vp.clientWidth, H = vp.clientHeight, w = el.offsetWidth / k, h = el.offsetHeight / k;
  const below = r.bottom + 12, above = r.top - 12 - h;
  const top = below + h <= H || above < 0 ? Math.min(Math.max(8, below), Math.max(8, H - h - 8)) : above;
  el.style.left = `${Math.max(12, Math.min(r.left + r.width / 2 - w / 2, W - w - 12))}px`;
  el.style.top = `${top}px`;
}

async function addTask(now) {
  const b = S.box;
  if (!b?.draft.trim()) return void $('.taskbox textarea')?.focus();
  try {
    const { result } = await api('/tasks/add', { block: b.block, path: b.path, label: b.label, width: frame.width, text: b.draft, question: b.question, images: b.images });
    closeBox();
    await loadTasks();
    if (now) await giveKaity([result.n]);
    else toast(result.kind === 'question' ? t('Question {n} added', { n: result.n }) : t('Task {n} added', { n: result.n }));
  } catch (e) {
    failed(e);
  }
}

// ---------- Kaity ----------

async function giveKaity(ns) {
  try {
    setRun((await api('/taskrun/start', ns ? { tasks: ns } : {})).run);
  } catch (e) {
    failed(e);
  }
}

/** A new state of Kaity's run: the bar and the tray follow, and the tray opens when she starts. */
function setRun(run) {
  const was = running();
  S.run = run;
  if (running() && !was) {
    S.followed = null;
    if (!S.stepsHidden) S.tray = true;
  }
  if (!running() && was && S.undoAllAfterStop) {
    S.undoAllAfterStop = false;
    void undoAll();
  }
  if (!S.run) S.stepsHidden = false;
  renderBar();
  renderTray();
  followKaity();
}

async function runAct(path, body = {}) {
  try {
    setRun((await api(path, body)).run);
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

async function undoAll() {
  if (running()) {
    // she stops first; her work goes once she has
    S.undoAllAfterStop = true;
    return runAct('/taskrun/stop');
  }
  if (await runAct('/taskrun/undo-all')) {
    toast(t('Everything Kaity did is undone. Undo brings it back.'));
    await Promise.all([loadState(), loadTasks()]);
  }
}

// ---------- the tray: the page's tasks, and Kaity's work on them ----------

function openTray(lit = null) {
  S.tray = true;
  S.lit = lit;
  renderTray();
  renderBar();
  if (lit) $(`.card[data-card="${lit}"]`)?.scrollIntoView({ block: 'nearest' });
}
function closeTray() {
  S.tray = false;
  S.lit = null;
  if (S.run || S.job) S.stepsHidden = true;
  renderTray();
  renderBar();
}

const STATE_WORDS = {
  waiting: () => t('waiting'), now: () => t('now'), done: () => t('done'), answered: () => t('answered'),
  'needs-you': () => t('needs you'), failed: () => t('not done'), off: () => t('off her list'),
};

const where = (x, badge) => `<p class="where">${badge}<b>${esc(x.block)}</b><span>${esc(plainLabel(x.label))}</span></p>`;
const numBadge = (x) => `<span class="num${x.kind === 'question' ? ' q' : ''}">${x.kind === 'question' ? esc(t('Question')) : x.n}</span>`;
/** Her conversation on the task's block, to read (the Kaity tab's, without asking from it). */
const convoBtn = (x) => `<button type="button" class="link" data-card-act="convo">${esc(t('See her conversation on {block}', { block: x.block }))}</button>`;

/** A task's pictures, small, each opening at full size. */
const pics = (x) => (x.images?.length ? `<div class="pics">${x.images.map((name, i) => `<a class="thumb" href="${API}/image/${encodeURIComponent(name)}" target="_blank" rel="noopener"><img src="${API}/image/${encodeURIComponent(name)}" alt="${esc(t('Picture {n} of task {task}', { n: i + 1, task: x.n }))}"></a>`).join('')}</div>` : '');
const btn = (act, label, cls = '', extra = '') => `<button type="button" class="btn small ${cls}" data-card-act="${act}" ${extra}>${esc(label)}</button>`;

/** A task not given to Kaity (or before she starts): the person's own card. */
function plainCard(x) {
  const q = x.kind === 'question';
  return `<article class="card${S.lit === x.n ? ' lit' : ''}" data-card="${x.n}">
    ${where(x, numBadge(x))}
    <p class="text">${esc(x.text)}</p>${pics(x)}
    ${q ? `<p class="note">${esc(t('Kaity answers here when she works through the list. She changes nothing for a question.'))}</p>` : ''}
    <div class="row">${btn('show', t('Show on the page'))}${q ? '' : btn('done', t('Mark done'))}${btn('remove', t('Remove'), 'danger')}</div>
  </article>`;
}

/** How to check a finished task, as fits it: on a phone, by trying the button, or on the page. */
function check(x) {
  const tag = labelTag(x.label);
  if ((x.width && x.width < 700) || /\b(phone|mobile|small screen|narrow)\b/i.test(x.text)) return btn('phone', t('See it on a phone'), 'primary');
  if (tag === 'a' || tag === 'button') return btn('try', tag === 'a' ? t('Try the link') : t('Try the button'), 'primary');
  return btn('show', t('Show on the page'), 'primary');
}

/** What she left unfinished in a task (src/check.ts), and the person's choice: she finishes it, or it stays. */
function leftNote(r) {
  const items = r.left.items ?? [], n = items.length;
  const head = {
    open: n === 1 ? t('Kaity left 1 thing unfinished') : t('Kaity left {n} things unfinished', { n }),
    fixing: n === 1 ? t('Kaity was asked to finish 1 thing') : t('Kaity was asked to finish {n} things', { n }),
    left: n === 1 ? t('1 thing left as it is') : t('{n} things left as they are', { n }),
  }[r.left.state];
  const shown = r.left.state === 'open' ? 8 : 3;
  return `<div class="left ${esc(r.left.state)}"><b>${esc(head)}</b>
    <ul>${items.slice(0, shown).map((i) => `<li>${esc(i.text)}</li>`).join('')}${n > shown ? `<li class="more">${esc(t('and {n} more', { n: n - shown }))}</li>` : ''}</ul>
    ${r.left.state === 'open' ? `<div class="row">${btn('fix-left', t('Fix them'), 'primary')}${btn('leave-left', t('Leave them as they are'))}</div>` : ''}</div>`;
}

/** A task in Kaity's run: what she is doing, did, or needs; and what the person can do about it. */
function runCard(r) {
  const x = taskOf(r.n) ?? { n: r.n, block: r.block, label: '', text: r.text, kind: r.question ? 'question' : undefined };
  const q = !!r.question;
  const word = STATE_WORDS[r.state]?.() ?? r.state;
  const badge = `<span class="state ${esc(r.state)}">${esc(q ? t('Question · {state}', { state: word }) : t('{n} · {state}', { n: r.n, state: word }))}</span>`;
  const busy = running();
  const more = S.more?.n === r.n ? `
    <label class="ask" for="more-${r.n}">${esc(q ? t('Your follow-up question') : t('What more should she do here?'))}</label>
    <textarea id="more-${r.n}" data-more>${esc(S.more.draft)}</textarea>
    <div class="row">${btn('more-give', q ? t('Ask Kaity') : t('Give it to Kaity'), 'primary')}${btn('more-cancel', t('Cancel'))}</div>` : '';
  let body = '', actions = '';
  if (r.state === 'now') {
    body = `<p class="note">${esc(r.step ?? t('Starting…'))}</p>`;
    actions = btn('show', t('Show on the page'));
  } else if (r.state === 'waiting') {
    body = q ? `<p class="note">${esc(t('She answers after the tasks.'))}</p>` : r.answer ? `<p class="note">${esc(t('Your answer: {a}', { a: r.answer }))}</p>` : '';
    actions = btn('skip', t('Take it off her list'));
  } else if (r.state === 'done') {
    body = r.undone ? `<p class="note">${esc(t('Her work on it was undone.'))}</p>` : `<p class="note">${esc(r.summary ?? '')}</p>${r.left ? leftNote(r) : ''}`;
    actions = r.undone ? btn('again', t('Give it to her again'))
      : `${check(x)}${r.before && r.after ? btn('compare', busy ? t('See before and after') : t('Before and after')) : ''}${btn('undo', t('Undo this one'), '', busy ? `disabled title="${esc(t('When she is done'))}"` : '')}${btn('more', t('Ask for more'))}${convoBtn(x)}`;
  } else if (r.state === 'answered') {
    return `<article class="card" data-card="${r.n}">
      ${where(x, badge)}
      <p class="youasked">${esc(t('You asked: {q}', { q: x.text }))}</p>${pics(x)}
      <p class="answer">${esc(r.summary ?? '')}</p>
      ${more}
      <div class="row">${S.more?.n === r.n ? '' : btn('more', t('Ask a follow-up'))}${btn('seen', t('Got it'))}${convoBtn(x)}</div>
    </article>`;
  } else if (r.state === 'needs-you') {
    return `<article class="card needs" data-card="${r.n}">
      ${where(x, badge)}
      <p class="text">${esc(x.text)}</p>${pics(x)}
      <p class="asked">${esc(t('Kaity asks: {q}', { q: r.asked ?? '' }))}</p>
      <textarea data-answer aria-label="${esc(t('Your answer to Kaity'))}" placeholder="${esc(t('Write the answer, or say how to work it out'))}">${esc(S.answers[r.n] ?? '')}</textarea>
      <div class="row">${btn('answer', t('Answer and continue'), 'primary')}${btn('leave', t('Leave it for later'))}</div>
    </article>`;
  } else if (r.state === 'failed') {
    body = `<p class="note">${esc(r.summary ?? '')}</p>`;
    actions = `${btn('again', t('Give it to her again'))}${btn('show', t('Show on the page'))}`;
  } else {
    body = `<p class="note">${esc(r.undone ? t('Her work on it was undone.') : t('Off her list: the task stays open.'))}</p>`;
    actions = taskOf(r.n) && !taskOf(r.n).done ? btn('again', t('Give it to her again')) : '';
  }
  const cls = ['card', r.state === 'now' ? 'now' : '', S.lit === r.n ? 'lit' : ''].join(' ');
  return `<article class="${cls}" data-card="${r.n}">
    ${where(x, badge)}
    <p class="text">${esc(x.text)}</p>${pics(x)}
    ${body}${more}
    <div class="row">${S.more?.n === r.n ? '' : actions}</div>
  </article>`;
}

function renderTray() {
  const tray = $('.tray');
  tray.hidden = !S.tray;
  if (!S.tray) return draw();
  // keep what is being typed in the tray across a redraw
  const focused = document.activeElement?.closest?.('.tray textarea') ? { n: document.activeElement.closest('[data-card]')?.dataset.card, more: document.activeElement.hasAttribute('data-more'), at: document.activeElement.selectionStart } : null;
  const open = openTasks();
  const tools = `<div class="tools">
        <button type="button" class="btn" data-tray="copy" ${open.length ? '' : 'disabled'}>${esc(t('Copy all for another agent'))}</button>
        <a class="btn" href="${API}/handbook" target="_blank" rel="noopener">${esc(t('Open the handbook'))}</a>
      </div>`;
  const how = `<p class="how">${esc(t('Kaity takes them one by one and only touches the box each task points at.'))}</p>`;
  const mine = runTasks();
  if (S.job) {
    const ai = S.job.kind === 'ai';
    const sub = S.job.state === 'running'
      ? (ai ? t('Watch it work, step by step. You can stop it at any time, and everything it does can be undone.') : t('TYKERF is opening the site, measuring it and cutting it into blocks. This usually takes under a minute.'))
      : S.job.state === 'stopped' ? (ai ? t('What Kaity built so far stays. Undo any step, or leave her tasks on the page.') : t('This unfinished page is being removed.'))
      : S.job.state === 'failed' ? `${S.job.error ?? ''} ${ai ? t('What Kaity built before that stays.') : t('The page stays empty: remove it, or try another address.')}`
      : ai ? (S.job.answer ?? '') : t('The copy is ready: click anything on it and say what should change.');
    tray.innerHTML = `<div class="head"><h2>${esc(jobTitle(S.job))}</h2><p class="how">${esc(sub)}</p></div>
      <ol class="jobsteps">${S.job.steps.map((s, i) => `<li class="${s.refused ? 'refused' : ''}${i === S.job.steps.length - 1 && S.job.state === 'running' ? ' now' : ''}">${s.refused ? `<b>${esc(t('Refused:'))}</b> ` : ''}${esc(ai ? s.text : t(s.text, s.vars ?? {}))}</li>`).join('') || `<li>${esc(t('Starting…'))}</li>`}</ol>`;
    return draw();
  }
  if (S.run && mine.length) {
    const inRun = new Set(S.run.tasks.map((x) => x.n));
    const others = open.filter((x) => !inRun.has(x.n));
    const title = running() ? t('Kaity is working through {n} on {page}', { n: mine.length === 1 ? t('1 task') : t('{n} tasks', { n: mine.length }), page: PAGE }) : t('What Kaity did on {page}', { page: PAGE });
    tray.innerHTML = `<div class="head"><h2>${esc(title)}</h2>${how}${tools}</div>
      <div class="cards">${mine.map(runCard).join('')}</div>
      ${others.length ? `<h3>${esc(t('Not given to Kaity'))}</h3><div class="cards">${others.map(plainCard).join('')}</div>` : ''}`;
  } else {
    const nq = open.filter((x) => x.kind === 'question').length, nt = open.length - nq;
    const tasksWord = nt === 1 ? t('1 task') : t('{n} tasks', { n: nt });
    const questionsWord = nq === 1 ? t('1 question') : t('{n} questions', { n: nq });
    const title = !open.length ? t('No tasks on {page}', { page: PAGE })
      : nq && nt ? t('{tasks} and {questions} on {page}', { tasks: tasksWord, questions: questionsWord, page: PAGE })
      : t('{things} on {page}', { things: nq ? questionsWord : tasksWord, page: PAGE });
    tray.innerHTML = `<div class="head"><h2>${esc(title)}</h2>${how}${tools}</div>
      ${open.length ? `<div class="cards">${open.map(plainCard).join('')}</div>` : `<p class="empty">${esc(t('Click anything on the page and say what should change.'))}</p>`}`;
  }
  if (focused?.n) {
    const ta = $(`.card[data-card="${focused.n}"] textarea${focused.more ? '[data-more]' : '[data-answer]'}`, tray);
    if (ta) (ta.focus(), ta.setSelectionRange(focused.at, focused.at));
  }
  draw();
}

const tray = $('.tray');
tray.addEventListener('input', (e) => {
  const n = Number(e.target.closest('[data-card]')?.dataset.card);
  if (e.target.matches('[data-answer]')) S.answers[n] = e.target.value;
  if (e.target.matches('[data-more]') && S.more) S.more.draft = e.target.value;
});
tray.addEventListener('click', async (e) => {
  if (e.target.closest('[data-tray="copy"]')) return copyAll();
  const b = e.target.closest('[data-card-act]');
  if (!b) return;
  const n = Number(b.closest('[data-card]').dataset.card);
  const x = taskOf(n);
  const act = b.dataset.cardAct;
  try {
    if (act === 'show') return x && showTask(x);
    if (act === 'phone') return seeOnPhone(x);
    if (act === 'try') return tryIt(x);
    if (act === 'compare') return compare(n);
    if (act === 'convo') return conversation(S.run?.tasks.find((y) => y.n === n)?.block ?? x?.block);
    if (act === 'fix-left') return runAct('/taskrun/fix', { n });
    if (act === 'leave-left') return runAct('/taskrun/leave-left', { n });
    if (act === 'more') return (S.more = { n, draft: '' }), renderTray(), $(`.card[data-card="${n}"] [data-more]`)?.focus();
    if (act === 'more-cancel') return (S.more = null), renderTray();
    if (act === 'more-give') return askMore(x);
    if (act === 'skip') return runAct('/taskrun/skip', { n });
    if (act === 'leave') return runAct('/taskrun/leave', { n });
    if (act === 'seen') return runAct('/taskrun/seen', { n });
    if (act === 'again') return giveKaity([n]);
    if (act === 'answer') {
      const a = (S.answers[n] ?? '').trim();
      if (!a) return $(`.card[data-card="${n}"] [data-answer]`)?.focus();
      if (await runAct('/taskrun/answer', { n, answer: a })) delete S.answers[n];
      return;
    }
    if (act === 'undo') {
      if (await runAct('/taskrun/undo', { n })) toast(t('Her work on task {n} is undone. Undo brings it back.', { n }));
      return Promise.all([loadState(), loadTasks()]);
    }
    if (act === 'done') await api('/tasks/close', { n });
    if (act === 'remove') await api('/tasks/remove', { n });
    await Promise.all([loadTasks(), loadState()]);
  } catch (err) {
    failed(err);
  }
});

/** "Ask for more" / "Ask a follow-up": a new task on the same element, given to Kaity at once. */
async function askMore(x) {
  const text = S.more?.draft.trim();
  if (!text || !x) return $(`.card[data-card="${x?.n}"] [data-more]`)?.focus();
  try {
    const { result } = await api('/tasks/add', { block: x.block, path: x.path, label: x.label, width: x.width, text, question: x.kind === 'question' });
    S.more = null;
    await loadTasks();
    await giveKaity([result.n]);
  } catch (e) {
    failed(e);
  }
}

function flash(el) {
  setTimeout(() => {
    const r = frame.rect(el);
    if (!r) return;
    const f = document.createElement('div');
    f.className = 'outline flash';
    Object.assign(f.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    overlay.append(f);
    setTimeout(() => f.remove(), 2600);
  }, stillMotion ? 0 : 450);
}

function showTask(x) {
  const el = frame.taskEl(x.block, x.path);
  if (!el) return toast(t('{block} is not on the page any more', { block: x.block }), true);
  frame.show(el, trayHeight());
  S.lit = x.n;
  renderTray();
  flash(el);
}

/** The widths the page can be seen at, from the bar: its own, a tablet held upright, a phone. */
const DEVICES = {
  full: { px: null, label: () => t('Full width'), icon: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M8 20h8M12 17v3"/>' },
  tablet: { px: 768, label: () => t('Tablet, upright (768 px)'), icon: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18.5h2"/>' },
  phone: { px: 375, label: () => t('Phone (375 px)'), icon: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>' },
};

/** The page at that width (the frame lays out again at it; tasks written now say that width). */
function setDevice(d) {
  if (!DEVICES[d] || S.device === d) return;
  S.device = d;
  const stage = $('.stage');
  stage.classList.toggle('phone', d === 'phone');
  stage.classList.toggle('tablet', d === 'tablet');
  layoutStage();
  setTimeout(draw, 60);
}

/** The page at a phone's width, on the task's element; the bar's Full width ends it. */
function seeOnPhone(x) {
  S.tray = false;
  renderTray();
  setDevice('phone');
  // the frame lays out again at 375 px before the element is found
  setTimeout(() => x && showTask(x), 120);
}
const fullWidth = () => setDevice('full');

/** Try the result: the page reacts as for a visitor until Done (links that leave the page only say where they lead). */
function tryIt(x) {
  S.trying = x.n;
  frame.try(true);
  S.tray = false;
  closeBox();
  renderTray();
  renderBar();
  showTask(x);
}
function doneTrying() {
  S.trying = null;
  frame.try(false);
  renderBar();
  draw();
}

/** Before and after: the task's block as Kaity found it and as she left it. */
function compare(n) {
  const r = S.run?.tasks.find((y) => y.n === n);
  const x = taskOf(n);
  if (!r?.before || !r.after) return;
  const d = $('.compare');
  const w = x?.width ?? 1440;
  const v = Date.now();
  d.innerHTML = `<h2>${esc(t('Task {n}: before and after', { n }))}</h2>
    <p class="note">${esc(x?.text ?? '')} · ${esc(t('{block} at {w} px', { block: r.block, w }))}</p>
    <div class="pair">
      <figure><figcaption>${esc(t('Before'))}</figcaption><img src="${API}/taskrun/picture/${encodeURIComponent(r.before)}?v=${v}" alt="${esc(t('{block} before Kaity worked on it', { block: r.block }))}"></figure>
      <figure><figcaption>${esc(t('After'))}</figcaption><img src="${API}/taskrun/picture/${encodeURIComponent(r.after)}?v=${v}" alt="${esc(t('{block} after Kaity worked on it', { block: r.block }))}"></figure>
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>${esc(t('Close'))}</button></div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  d.showModal();
}

/** Read Kaity's conversation on a block: what was asked, her steps and answers, what she left. Nothing to ask from here. */
async function conversation(block) {
  if (!block) return;
  const d = $('.convo');
  let chat;
  try {
    chat = await api(`/chat?id=${encodeURIComponent(block)}`);
  } catch (e) {
    return failed(e);
  }
  const msgs = [];
  for (const m of chat.messages ?? []) {
    if (m.role === 'step' && msgs.at(-1)?.role === 'steps') msgs.at(-1).items.push(m.text);
    else if (m.role === 'step') msgs.push({ role: 'steps', items: [m.text] });
    else msgs.push(m);
  }
  const img = (f) => `${API}/image/${encodeURIComponent(f)}`;
  const one = (m) => {
    if (m.role === 'steps') return `<details class="steps"><summary>${esc(m.items.length === 1 ? t('1 step') : t('{n} steps', { n: m.items.length }))}</summary>${m.items.map((x) => `<div>${esc(x)}</div>`).join('')}</details>`;
    if (m.role === 'check') {
      const n = m.items?.length ?? 0;
      const head = { auto: n === 1 ? t('Kaity checks the 1 thing she left unfinished') : t('Kaity checks the {n} things she left unfinished', { n }), open: n === 1 ? t('Kaity left 1 thing unfinished') : t('Kaity left {n} things unfinished', { n }), fixing: n === 1 ? t('Kaity was asked to finish 1 thing') : t('Kaity was asked to finish {n} things', { n }), left: n === 1 ? t('1 thing left as it is') : t('{n} things left as they are', { n }) }[m.state] ?? m.text;
      return `<div class="msg check"><b>${esc(head)}</b><ul>${(m.items ?? []).map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul></div>`;
    }
    const who = m.role === 'ai' ? `<span class="who">${kaityMark()}Kaity</span>` : m.role === 'user' ? `<span class="who">${esc(t('Asked'))}</span>` : '';
    const pics = m.images?.length ? `<div class="pics">${m.images.map((f) => `<a class="thumb" href="${img(f)}" target="_blank" rel="noopener"><img src="${img(f)}" alt="${esc(t('attached image'))}"></a>`).join('')}</div>` : '';
    return `<div class="msg ${esc(m.role)}">${who}${pics}${m.role === 'ai' ? `<div class="md">${markdown(m.text)}</div>` : `<p>${esc(m.text)}</p>`}</div>`;
  };
  d.innerHTML = `<h2>${esc(t('Kaity on {block}', { block }))}</h2>
    <p class="note">${esc(t('Every task on {block} continues this conversation, so she remembers what was asked before.', { block }))}</p>
    <div class="log">${msgs.length ? msgs.map(one).join('') : `<p class="empty">${esc(t('Nothing was asked on {block} yet.', { block }))}</p>`}</div>
    <div class="row"><button type="button" class="btn primary" data-close>${esc(t('Close'))}</button></div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  d.showModal();
  const log = d.querySelector('.log');
  log.scrollTop = log.scrollHeight;
}

async function copyAll() {
  try {
    await navigator.clipboard.writeText(S.tasksText);
    toast(t('The open tasks are copied: paste them to any agent'));
  } catch {
    toast(t('Copying was refused by the browser'), true);
  }
}

/** What the page's job is doing, or how it ended, in a few words. */
function jobTitle(job) {
  const ai = job.kind === 'ai';
  return job.state === 'running' ? (ai ? t('Kaity is building {page}', { page: PAGE }) : t('Copying {site}', { site: job.site ?? '' }))
    : job.state === 'done' ? t('Your page is ready')
    : job.state === 'stopped' ? (ai ? t('Stopped') : t('Copy stopped'))
    : t('Something went wrong');
}

/**
 * A new state of the page's job: the bar and the tray follow. The tray opens when it starts, and on arriving at a
 * page whose job ended unseen (a fast build is over before the page opens: what happened is still there to read).
 */
function setJob(job, { arriving = false } = {}) {
  if (FULL) return; // the full editor shows a page being made itself
  const was = S.job?.state === 'running';
  S.job = job;
  if (job && ((job.state === 'running' && !was) || arriving) && !S.stepsHidden) S.tray = true;
  renderBar();
  renderTray();
}

// ---------- the bar ----------

const bar = $('.bar');

/** What Kaity's finished run comes to, in a few words: "2 done, 1 answered, 1 needs you". */
function runSum(run) {
  const n = (s) => run.tasks.filter((x) => x.state === s && !x.undone && !x.seen).length;
  const needs = n('needs-you'), failedN = n('failed'), waiting = n('waiting');
  return [
    n('done') && t('{n} done', { n: n('done') }),
    n('answered') && t('{n} answered', { n: n('answered') }),
    needs && (needs === 1 ? t('1 needs you') : t('{n} need you', { n: needs })),
    failedN && t('{n} not done', { n: failedN }),
    waiting && t('{n} still waiting', { n: waiting }),
  ].filter(Boolean).join(', ') || t('nothing left to review');
}

function renderBar() {
  const open = openTasks();
  const run = S.run;
  const count = open.length === 1 ? t('1 task') : t('{n} tasks', { n: open.length });
  const undoTitle = S.lastChange ? t('Undo "{step}"', { step: S.lastChange }) : t('Nothing to undo');
  const switcher = `<button type="button" class="switcher" data-bar="pages" aria-expanded="${sidebar?.isOpen() ?? false}" aria-label="${esc(t('Pages of the site: {page} is open', { page: PAGE }))}">${MARK}<span class="name">${esc(PAGE)}</span><span class="addr">/${esc(PAGE)}/</span>${CHEVRON}</button>`;
  const hideBtn = `<button type="button" class="btn" data-bar="hide" aria-label="${esc(t('Hide tykerf'))}" title="${esc(t('See the page as a visitor does (Alt+Shift+T)'))}">${esc(t('Hide tykerf'))}</button>`;
  // Tasks | Full editor: the shell's two modes (the fix in hand goes along to the full editor)
  const modes = `<nav class="modes" aria-label="${esc(t('Mode'))}"><a href="${shellOf(PAGE, false)}" ${FULL ? '' : 'aria-current="page"'}>${esc(t('Tasks'))}</a><a href="${fullEditor(!FULL ? fix?.selected : null)}" ${FULL ? 'aria-current="page"' : ''} aria-label="${esc(t('Full editor'))}" title="${esc(t('Every block in detail: the box tree, text, code, sizes, look and the page\'s theme'))}">${esc(t('Full editor'))}</a></nav>`;
  const stepsBtn = `<button type="button" class="btn" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('Hide the steps') : t('Show the steps'))}</button>`;
  let middle, actions;
  if (FULL && !running()) {
    middle = `<p class="hint">${esc(t('Every block in detail: select one on the page or in the tree.'))}</p>`;
    // the tray is Tasks' own (R9): from here the count leads there
    actions = `<a class="btn" href="${shellOf(PAGE, false)}" title="${esc(t('Your tasks are in Tasks'))}">${esc(count)}</a>${hideBtn}`;
  } else if (fix?.isOpen()) {
    middle = `<div class="status" role="status"><span>${esc(t('Fixing by hand · {what}', { what: fix.what() }))}</span><button type="button" class="btn main" data-bar="done-fixing">${esc(t('Done, back to tasks'))}</button></div>`;
    actions = `<button type="button" class="btn" data-bar="tray" aria-expanded="${S.tray}">${esc(count)}</button>
      <button type="button" class="btn" data-bar="undo" title="${esc(undoTitle)}" aria-label="${esc(undoTitle)}" ${S.canUndo ? '' : 'disabled'}>${esc(t('Undo'))}</button>${hideBtn}`;
  } else if (S.job && !S.trying) {
    const ai = S.job.kind === 'ai', going = S.job.state === 'running';
    const last = S.job.steps.at(-1);
    const step = last ? (ai ? last.text : t(last.text, last.vars ?? {})) : '';
    middle = `<div class="status" role="status">${kaityMark(going && ai)}<span>${esc(jobTitle(S.job))}</span>${going && step ? `<span class="chip">${esc(step)}</span>` : ''}</div>`;
    actions = `${going ? `<button type="button" class="btn on" data-bar="job-stop">${esc(ai ? t('Stop Kaity') : t('Stop the copy'))}</button>` : `<button type="button" class="btn main" data-bar="job-seen">${esc(t('Got it'))}</button>`}
      <button type="button" class="btn" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('Hide the steps') : t('Show the steps'))}</button>${hideBtn}`;
  } else if (S.trying) {
    middle = `<div class="status" role="status"><span>${esc(t('Trying the page: it works as for a visitor. Links to other pages only say where they lead.'))}</span></div>`;
    actions = `<button type="button" class="btn main" data-bar="done-trying">${esc(t('Done trying'))}</button>`;
  } else if (running()) {
    const mine = run.tasks.filter((x) => x.state !== 'off' && !x.seen);
    const now = run.tasks.find((x) => x.state === 'now');
    const i = now ? mine.indexOf(now) + 1 : mine.filter((x) => !['waiting', 'now'].includes(x.state)).length + 1;
    middle = `<div class="status" role="status">${kaityMark(true)}<span>${esc(t('Kaity is working · task {i} of {n}', { i: Math.min(i, mine.length), n: mine.length }))}</span>${now
      ? `<span class="chip"><span class="num${now.question ? ' q' : ''}">${now.question ? '?' : now.n}</span><b>${esc(now.block)}</b> ${esc(now.text)}</span>` : ''}</div>`;
    actions = `<button type="button" class="btn on" data-bar="stop">${esc(t('Stop Kaity'))}</button>
      <button type="button" class="btn" data-bar="undo-all">${esc(t('Undo all she did'))}</button>${stepsBtn}`;
  } else if (run) {
    const kept = run.tasks.filter((x) => x.state === 'done' && !x.undone).length;
    middle = `<div class="status" role="status">${kaityMark()}<span>${esc(t('Kaity stopped · {sum}', { sum: runSum(run) }))}</span></div>`;
    actions = `<button type="button" class="btn main" data-bar="keep">${esc(kept === 0 ? t('Close the review') : kept === 1 ? t('Keep the change') : t('Keep the {n} changes', { n: kept }))}</button>
      ${kept ? `<button type="button" class="btn" data-bar="undo-all">${esc(t('Undo all she did'))}</button>` : ''}${stepsBtn}${hideBtn}`;
  } else {
    middle = `<p class="hint">${esc(t('Click anything on the page and say what should change.'))}</p>`;
    actions = `<button type="button" class="btn${S.tray ? ' on' : ''}" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('{count} · close', { count }) : count)}</button>
      <button type="button" class="btn main" data-bar="give" ${open.length ? '' : 'disabled'}>${esc(open.length === 1 ? t('Give it to Kaity') : t('Give them to Kaity'))}</button>
      <button type="button" class="btn" data-bar="undo" title="${esc(undoTitle)}" aria-label="${esc(undoTitle)}" ${S.canUndo ? '' : 'disabled'}>${esc(t('Undo'))}</button>${hideBtn}`;
  }
  // the page's width: full (with how small it is shown, shrunk to fit beside a panel), a tablet held upright, a phone;
  // each says its own in a label of fixed width, so the box, and what comes after it, never move
  const pct = Math.round((S.device === 'full' ? S.zoom || 1 : 1) * 100);
  const sizeOf = (k, d) => (d.px ? String(d.px) : t('{n} %', { n: pct }));
  const titleOf = (k, d) => (k === 'full' && pct < 100 ? `${d.label()} · ${t('The page is laid out at its real width and shrunk to fit beside the panel')}` : d.label());
  const widths = `<div class="widths" role="group" aria-label="${esc(t('The page\'s width'))}">${Object.entries(DEVICES).map(([k, d]) =>
    `<button type="button" data-device="${k}" aria-pressed="${S.device === k}" aria-label="${esc(titleOf(k, d))}" title="${esc(titleOf(k, d))}"><svg viewBox="0 0 24 24" aria-hidden="true">${d.icon}</svg><span class="size">${esc(sizeOf(k, d))}</span></button>`).join('')}</div>`;
  bar.innerHTML = `${switcher}${modes}${widths}${middle}<div class="actions">${actions}</div>`;
}

bar.addEventListener('click', async (e) => {
  const device = e.target.closest('[data-device]')?.dataset.device;
  if (device) return setDevice(device);
  const act = e.target.closest('[data-bar]')?.dataset.bar;
  if (!act) return;
  if (act === 'pages') return sidebar.toggle();
  if (act === 'tray') return S.tray ? closeTray() : ((S.stepsHidden = false), openTray());
  if (act === 'give') return giveKaity(openTasks().map((x) => x.n));
  if (act === 'hide') return hide();
  if (act === 'undo') return undo();
  if (act === 'done-trying') return doneTrying();
  if (act === 'done-fixing') return fix.close();
  if (act === 'job-stop') return api('/job/stop', {}).catch(failed);
  if (act === 'job-seen') {
    await api('/job/seen', {}).catch(failed);
    S.job = null;
    S.tray = false;
    renderTray();
    return renderBar();
  }
  if (act === 'stop') return runAct('/taskrun/stop');
  if (act === 'undo-all') return undoAll();
  if (act === 'keep') {
    if (await runAct('/taskrun/keep')) (S.tray = false), renderTray(), loadTasks().catch(failed);
  }
});

async function undo() {
  if (!S.canUndo || running()) return;
  try {
    const r = await api('/undo', {});
    toast(t('Undone: {step}', { step: r.undone }));
    await Promise.all([loadState(), loadTasks()]);
  } catch (e) {
    failed(e);
  }
}

const hide = () => (location.href = `/${encodeURIComponent(PAGE)}/?tykerf=hidden`);

// ---------- the site sidebar, from the page switcher (site.js) ----------

/**
 * "Over the page" or "Shrink the page to fit", at the top of both sidebars; the choice is remembered. In Full editor
 * mode the page is always over: the full editor is in the page's frame, so shrinking the page would shrink its panel
 * too. Shrink shows there greyed out, with why (aria-disabled, so its tooltip still shows).
 */
const NO_SHRINK = () => t('In the full editor the page isn\'t shrunk: its panel would shrink with it.');
const modeSwitch = () => `<div class="modesw" role="group" aria-label="${esc(t('The page beside this panel'))}">
  <button type="button" data-mode="over" aria-pressed="${FULL || S.mode === 'over'}">${esc(t('Over the page'))}</button>
  <button type="button" data-mode="shrink" aria-pressed="${!FULL && S.mode === 'shrink'}" ${FULL ? `aria-disabled="true" title="${esc(NO_SHRINK())}"` : ''}>${esc(t('Shrink the page to fit'))}</button></div>`;
function setMode(m) {
  if (FULL) return toast(NO_SHRINK());
  S.mode = m;
  store.set('sidebarMode', m);
  for (const b of document.querySelectorAll('.modesw [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  layoutStage();
}

/**
 * The page beside an open sidebar. Over the page: the page stays as it is. Shrink to fit: it keeps its real width
 * (nothing reflows) and is scaled down into the room left beside the sidebar; what tykerf draws scales with it.
 */
function layoutStage() {
  const vp = $('.viewport'), stage = $('.stage');
  const panel = fix?.isOpen() ? fix.el : sidebar.isShown() ? sidebar.el : null;
  const shrink = panel && S.mode === 'shrink' && S.device === 'full' && !FULL;
  if (!shrink) {
    vp.style.cssText = '';
    S.zoom = 1;
  } else {
    const W = stage.clientWidth, H = stage.clientHeight, side = panel.offsetWidth, k = Math.max(0.2, (W - side) / W);
    Object.assign(vp.style, { position: 'absolute', left: `${side}px`, top: '0', width: `${W}px`, height: `${H / k}px`, transform: `scale(${k})`, transformOrigin: '0 0', margin: '0' });
    S.zoom = k;
  }
  renderBar();
  draw();
}

const sidebar = createSidebar({ page: PAGE, onChange: () => layoutStage(), modeSwitch, setMode, pageHref: (p) => shellOf(p, false) }); // a page always opens in Tasks (R1)

// ---------- fixing one thing by hand (fix.js) ----------

const fix = createFixPanel({
  api,
  frame,
  page: PAGE,
  tree: () => S.tree,
  blocks: () => [...S.blocks],
  pages: () => S.site?.pages ?? [PAGE],
  siteKit: () => S.kit,
  fullEditor,
  modeSwitch,
  setMode,
  onChange: () => layoutStage(),
  onClose: () => (sidebar.resume(), layoutStage()),
  toTask: (spot) => {
    const el = frame.taskEl(spot.block, spot.path);
    if (el) openBox({ ...spot, el });
  },
});

async function openFix(spot) {
  // the fix panel takes the left: the sidebar steps aside, and comes back as it was when the fix is done
  sidebar.suspend();
  closeBox();
  if (S.tray) closeTray();
  S.kit ??= await request('/_tykerf/site/kit').catch(() => null);
  await fix.open(spot);
}

// ---------- keys: in the shell and in the page ----------

function keys(e) {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.nodeName ?? '') || e.target?.isContentEditable;
  if (e.altKey && e.shiftKey && e.code === 'KeyT') return e.preventDefault(), hide();
  if (e.key === 'Escape') {
    if (S.box) return closeBox();
    if (fix.isOpen()) return fix.close();
    if (S.trying) return doneTrying();
    if (S.device !== 'full') return fullWidth();
    if (S.tray) return closeTray();
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) return e.preventDefault(), undo();
}
document.addEventListener('keydown', keys);

// ---------- loading, and live updates ----------

async function loadState() {
  const st = await api('/state');
  const ids = new Set();
  (function walk(n) {
    if (!n) return;
    ids.add(n.id);
    for (const c of n.children ?? []) walk(c);
  })(st.tree);
  S.blocks = ids;
  S.tree = st.tree;
  S.site = st.site;
  S.canUndo = st.canUndo;
  S.lastChange = st.lastChange;
  const headChanged = S.head !== null && st.head !== S.head;
  S.head = st.head;
  setRun(st.taskRun ?? null);
  return headChanged;
}

async function loadTasks() {
  const r = await api('/tasks');
  S.tasks = r.tasks;
  S.next = r.next;
  S.tasksText = r.text;
  renderBar();
  renderTray();
}

/** The page changed (a change here, Kaity's, or from outside): new content in place, or a reload for a new head. */
async function refresh() {
  try {
    const headChanged = await loadState();
    // the full editor follows the page's changes itself
    if (FULL) return void (await loadTasks());
    if (headChanged) frame.load(frameSrc(), { keepScroll: true });
    else frame.swap(await api('/page'));
    await loadTasks();
    if (S.box && !frame.taskEl(S.box.block, S.box.path)) closeBox();
    if (fix.isOpen()) fix.reload();
  } catch (e) {
    failed(e);
  }
}

let debounce = 0;
const events = new EventSource(`${API}/events`);
events.addEventListener('changed', () => (clearTimeout(debounce), (debounce = setTimeout(refresh, 60))));
events.addEventListener('tasks', () => loadTasks().catch(failed));
events.addEventListener('taskrun', (e) => setRun(JSON.parse(e.data)));
events.addEventListener('job', (e) => setJob(JSON.parse(e.data)));
// the page was renamed or removed (maybe from another tab): follow it
events.addEventListener('moved', (e) => {
  const to = JSON.parse(e.data).url;
  const m = /^\/([^/]+)\/$/.exec(to);
  location.replace(m ? shellOf(decodeURIComponent(m[1])) : '/_tykerf/edit/_site/tasks');
});

addEventListener('resize', () => layoutStage());

// ---------- the second button: what can be done on the element under the pointer ----------

const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctxmenu';
ctxMenu.setAttribute('role', 'menu');
ctxMenu.hidden = true;
document.body.append(ctxMenu);
let menuSpot = null;

/** An element whose words can be edited right on the page: text only, nothing else inside it. */
const textOnly = (el) => !!el && el.children.length === 0 && !!el.textContent.trim() && !/^(SCRIPT|STYLE|TEMPLATE|TEXTAREA|INPUT|SELECT|SVG)$/i.test(el.nodeName);

/** What the menu acts on, as its header: the box, then the element in words. */
const ctxHead = (spot) => `<div class="ctxhead"><b>${esc(spot.block)}</b><span>${esc(spot.path ? plainLabel(spot.label) : t('the {block} box', { block: spot.block }))}</span></div>`;

/**
 * The menu for an element: from the second button (x, y in the frame), or from the task box's More… (`at`: a point in
 * the window; the box stays, with what is written in it, and the menu leaves out the task and the question).
 */
function openMenu(spot, x, y, { at = null } = {}) {
  if (!at) closeBox();
  menuSpot = spot;
  const item = (act, label, cls = '') => `<button type="button" role="menuitem" data-ctx="${act}" ${cls ? `class="${cls}"` : ''}>${esc(label)}</button>`;
  const el = frame.taskEl(spot.block, spot.path);
  const isPage = spot.block === S.tree?.id; // the page itself has nothing beside or below it, and isn't deleted
  ctxMenu.innerHTML = `${ctxHead(spot)}
    ${at ? '' : `${item('task', t('Leave a task here…'))}${item('question', t('Ask a question here…'))}`}
    ${spot.path && textOnly(el) ? item('text', t('Edit this text')) : ''}
    ${item('hand', t('Fix it by hand'))}
    ${isPage ? '' : `<hr>${item('below', t('Add a box below…'))}${item('beside', t('Add a box beside…'))}${item('delete', t('Delete this box…'), 'danger')}`}
    <hr>${item('full', t('Open {block} in the full editor', { block: spot.block }))}
    ${item('hide', t('Hide tykerf'))}`;
  // where the pointer is, in the window: the frame's place on the stage, at the page's zoom
  const f = $('.frame').getBoundingClientRect(), k = S.zoom || 1;
  ctxMenu.hidden = false;
  const px = at ? at.x : f.left + x * k;
  // from More…: below the link, or above it when there is no room below
  const py = at ? (at.y + ctxMenu.offsetHeight > innerHeight - 8 && at.above - ctxMenu.offsetHeight >= 8 ? at.above - ctxMenu.offsetHeight : at.y) : f.top + y * k;
  const left = Math.min(px, innerWidth - ctxMenu.offsetWidth - 8), top = Math.min(py, innerHeight - ctxMenu.offsetHeight - 8);
  Object.assign(ctxMenu.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
  $('[role=menuitem]', ctxMenu).focus();
}
const closeCtx = () => ((ctxMenu.hidden = true), (menuSpot = null));

ctxMenu.addEventListener('click', (e) => {
  const act = e.target.closest('[data-ctx]')?.dataset.ctx;
  const spot = menuSpot;
  if (!act || !spot) return;
  closeCtx();
  if (act === 'delete-yes') return void deleteBox(spot.block);
  const el = frame.taskEl(spot.block, spot.path);
  if (act === 'task' && el) openBox({ ...spot, el });
  if (act === 'question' && el) openBox({ ...spot, el, question: true });
  if (act === 'hand') openFix(spot);
  if (act === 'text' && el) (closeBox(), editInPlace(spot, el));
  if (act === 'below' || act === 'beside') addBox(spot, act === 'below' ? 'column' : 'row');
  if (act === 'delete') confirmDelete(spot);
  if (act === 'full') location.assign(fullEditor(spot.block));
  if (act === 'hide') hide();
});
// ---------- small changes from the menu: words in place, a box added or deleted (each one step; Undo takes it back) ----------

/** Edit the words of an element right on the page; Enter keeps them, Escape puts them back. */
function editInPlace(spot, el) {
  toast(t('Type the new words: Enter keeps them, Esc puts them back.'));
  frame.editText(el, async (changed, text, before) => {
    if (!changed) return;
    try {
      // the box as it is now: the words go into its code only when it still has the element as the page showed it
      const box = await api(`/box?id=${encodeURIComponent(spot.block)}`);
      const tpl = document.createElement('template');
      tpl.innerHTML = box.html;
      const code = atPath(tpl.content, spot.path);
      const words = (x) => x.replace(/\s+/g, ' ').trim();
      if (!code || code.children.length || words(code.textContent) !== words(before))
        throw new Error(t('{block} changed meanwhile, so this fix was not saved: look at it again.', { block: spot.block }));
      const [, lead, , tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(code.textContent);
      code.textContent = lead + text.replace(/\s+/g, ' ').trim() + tail;
      await api('/box', { id: spot.block, html: tpl.innerHTML });
      toast(t('Saved. Undo takes it back.'));
    } catch (e) {
      failed(e);
      await refresh(); // the page shows what the box really has
    }
  });
}

/** A new empty box below or beside this one; the task box opens on it, to say what goes there. */
async function addBox(spot, as) {
  try {
    const { result: id } = await api('/op', { op: 'insert', id: spot.block, as });
    // the page brings it in with the change; then a task on it
    for (let i = 0; i < 50 && !frame.blockEl(id); i++) await new Promise((ok) => setTimeout(ok, 100));
    const el = frame.blockEl(id);
    if (!el) return toast(t('{block} was added. Undo takes it back.', { block: id }));
    openBox({ block: id, path: null, label: '', el, fresh: true, near: spot.block });
  } catch (e) {
    failed(e);
  }
}

/** Delete asks first, in the menu: the box's code goes into the box before it, and Undo brings it back. */
function confirmDelete(spot) {
  menuSpot = spot;
  ctxMenu.innerHTML = `${ctxHead(spot)}<div class="ctxconfirm" role="alert"><p>${esc(t('Delete {block}? Its code goes into the box before it, and Undo brings it back.', { block: spot.block }))}</p>
    <div class="row"><button type="button" role="menuitem" class="btn small danger" data-ctx="delete-yes">${esc(t('Delete {block}', { block: spot.block }))}</button><button type="button" role="menuitem" class="btn small" data-ctx="cancel">${esc(t('Cancel'))}</button></div></div>`;
  ctxMenu.hidden = false;
  $('[data-ctx="cancel"]', ctxMenu).focus();
}
async function deleteBox(id) {
  try {
    await api('/op', { op: 'delete', id });
    toast(t('{block} is deleted. Undo brings it back.', { block: id }));
  } catch (err) {
    failed(err);
  }
}

ctxMenu.addEventListener('keydown', (e) => {
  const items = [...ctxMenu.querySelectorAll('[role=menuitem]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') (e.preventDefault(), items[(i + 1) % items.length].focus());
  if (e.key === 'ArrowUp') (e.preventDefault(), items[(i - 1 + items.length) % items.length].focus());
  // Escape closes only the menu: a task box under it (its More…) stays, with what is written in it
  if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), closeCtx(), $('.taskbox textarea')?.focus());
});
document.addEventListener('pointerdown', (e) => !ctxMenu.hidden && !ctxMenu.contains(e.target) && closeCtx());

/** Arriving from a site screen: ?show=<box> shows that box, ?task=<box> opens a task on it (once). */
function arrive() {
  if (FULL) return;
  const q = new URLSearchParams(location.search);
  const show = q.get('show'), task = q.get('task'), talk = q.get('conversation');
  if (!show && !task && !talk) return;
  window.history.replaceState(null, '', location.pathname);
  // from Kaity's work: her conversation on that block (on the page or not: the conversation stays)
  if (talk) return void conversation(talk);
  const block = show ?? task;
  const el = frame.blockEl(block);
  if (!el) return toast(t('{block} is not on this page', { block }), true);
  frame.show(el, 0);
  if (task) setTimeout(() => openBox({ block, path: null, el, label: '' }), 300);
  else flash(el);
}

document.title = `${PAGE} · tykerf`;
watchVersion();
await loadState();
await loadTasks();
setJob((await api('/job').catch(() => ({ job: null }))).job, { arriving: true });
frame.load(frameSrc());
// the sidebar as the person left it on the last page: it stays until they close it
void sidebar.restore();
