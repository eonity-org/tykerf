// The v3 editor (shell.html at /_tykerf/edit/<page>/): one bar on top and the page below it in a frame, at its
// real width. Leaving tasks is the normal way to work: click anything on the page, say what should change, and
// hand the tasks to Kaity. She works through them one at a time (task-run.ts); the tray (from the top) shows each
// task as she goes, then the review: what she changed, before and after, undo one, answer what she asks.
// Everything tykerf draws over the page (outlines, pins, the task box) is in the shell's own document, over the
// frame; the page itself is untouched.

import { $, CHEVRON, MARK, esc, failed, kaityMark, plainLabel, request, stillMotion, store, t, toast, watchVersion } from './common.js';
import { createFixPanel } from './fix.js';
import { createFrame } from './frame.js';
import { createSidebar } from './site.js';

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
  phone: false, // the page at a phone's width (See it on a phone)
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
      if (sidebar.isOpen()) return closeMenu();
      // fixing by hand: a click picks the next thing to fix
      if (fix.isOpen()) return void fix.open(spot);
      // a task being written stays where it is; an empty one moves to what was clicked
      if (S.box?.draft.trim()) return void $('.taskbox textarea')?.focus();
      openBox(spot);
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
/** The full editor (the expert way: every block in detail), on a block when one is given. */
const fullEditor = (block) => `${shellOf(PAGE, true)}${block ? `&block=${encodeURIComponent(block)}&tab=text` : ''}`;

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
  closeMenu();
  S.box = { block: spot.block, path: spot.path, label: spot.label, draft: '', question: false, touched: false };
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
  el.innerHTML = `
    <p class="where"><span class="num${b.question ? ' q' : ''}">${b.question ? esc(t('Question')) : S.next}</span><b>${esc(b.block)}</b><span>${esc(plainLabel(b.label))} · ${esc(t('seen at {w} px', { w: frame.width }))}</span></p>
    <label class="ask" for="task-text">${esc(t('What should change here, or what do you want to ask?'))}</label>
    <textarea id="task-text" rows="2">${esc(b.draft)}</textarea>
    <label class="question"><input type="checkbox" ${b.question ? 'checked' : ''}> ${esc(t('This is a question: Kaity answers it and changes nothing'))}</label>
    <div class="row">
      <button type="button" class="link" data-box="hand">${esc(t('Fix it by hand'))}</button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-box="cancel">${esc(t('Cancel'))}</button>
      <button type="button" class="btn" data-box="now">${esc(b.question ? t('Kaity, answer it now') : t('Kaity, do it now'))}</button>
      <button type="button" class="btn primary" data-box="add">${esc(b.question ? t('Add question') : t('Add task'))}</button>
    </div>
    <p class="scope">${esc(t('Kaity changes only {block} for it.', { block: b.block }))}</p>`;
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
  $('input[type=checkbox]', el).onchange = (e) => {
    b.touched = true;
    b.question = e.target.checked;
    renderBox();
  };
  el.onclick = (e) => {
    const act = e.target.closest('[data-box]')?.dataset.box;
    if (act === 'cancel') closeBox();
    if (act === 'add') addTask(false);
    if (act === 'now') addTask(true);
    if (act === 'hand') {
      const spot = { block: b.block, path: b.path, label: b.label };
      closeBox();
      openFix(spot);
    }
  };
  const r = frame.rect(frame.taskEl(b.block, b.path));
  if (r) placeBox(el, r);
}

/** Below the element when there is room, else above it, inside the page's viewport. */
function placeBox(el, r) {
  const vp = $('.viewport');
  const W = vp.clientWidth, H = vp.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
  const below = r.bottom + 12, above = r.top - 12 - h;
  const top = below + h <= H || above < 0 ? Math.min(Math.max(8, below), Math.max(8, H - h - 8)) : above;
  el.style.left = `${Math.max(12, Math.min(r.left + r.width / 2 - w / 2, W - w - 12))}px`;
  el.style.top = `${top}px`;
}

async function addTask(now) {
  const b = S.box;
  if (!b?.draft.trim()) return void $('.taskbox textarea')?.focus();
  try {
    const { result } = await api('/tasks/add', { block: b.block, path: b.path, label: b.label, width: frame.width, text: b.draft, question: b.question });
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
const btn = (act, label, cls = '', extra = '') => `<button type="button" class="btn small ${cls}" data-card-act="${act}" ${extra}>${esc(label)}</button>`;

/** A task not given to Kaity (or before she starts): the person's own card. */
function plainCard(x) {
  const q = x.kind === 'question';
  return `<article class="card${S.lit === x.n ? ' lit' : ''}" data-card="${x.n}">
    ${where(x, numBadge(x))}
    <p class="text">${esc(x.text)}</p>
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
    body = r.undone ? `<p class="note">${esc(t('Her work on it was undone.'))}</p>` : `<p class="note">${esc(r.summary ?? '')}</p>`;
    actions = r.undone ? btn('again', t('Give it to her again'))
      : `${check(x)}${r.before && r.after ? btn('compare', busy ? t('See before and after') : t('Before and after')) : ''}${btn('undo', t('Undo this one'), '', busy ? `disabled title="${esc(t('When she is done'))}"` : '')}${btn('more', t('Ask for more'))}`;
  } else if (r.state === 'answered') {
    return `<article class="card" data-card="${r.n}">
      ${where(x, badge)}
      <p class="youasked">${esc(t('You asked: {q}', { q: x.text }))}</p>
      <p class="answer">${esc(r.summary ?? '')}</p>
      ${more}
      <div class="row">${S.more?.n === r.n ? '' : btn('more', t('Ask a follow-up'))}${btn('seen', t('Got it'))}</div>
    </article>`;
  } else if (r.state === 'needs-you') {
    return `<article class="card needs" data-card="${r.n}">
      ${where(x, badge)}
      <p class="text">${esc(x.text)}</p>
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
    <p class="text">${esc(x.text)}</p>
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

/** The page at a phone's width, on the task's element; Back to full width ends it. */
function seeOnPhone(x) {
  S.phone = true;
  $('.stage').classList.add('phone');
  S.tray = false;
  renderTray();
  renderBar();
  // the frame lays out again at 375 px before the element is found
  setTimeout(() => x && showTask(x), 120);
}
function fullWidth() {
  S.phone = false;
  $('.stage').classList.remove('phone');
  renderBar();
  setTimeout(draw, 60);
}

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
  const modes = `<nav class="modes" aria-label="${esc(t('Mode'))}"><a href="${shellOf(PAGE, false)}" ${FULL ? '' : 'aria-current="page"'}>${esc(t('Tasks'))}</a><a href="${fullEditor(!FULL ? fix?.selected : null)}" ${FULL ? 'aria-current="page"' : ''} aria-label="${esc(t('Full editor'))}" title="${esc(t('Every block in detail: text, code, sizes, look, Kaity block by block'))}">${esc(t('Full editor'))}</a></nav>`;
  const stepsBtn = `<button type="button" class="btn" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('Hide the steps') : t('Show the steps'))}</button>`;
  let middle, actions;
  const zoom = S.zoom && S.zoom < 0.999 ? `<span class="zoom" title="${esc(t('The page is laid out at its real width and shrunk to fit beside the panel'))}">${esc(t('{n} %', { n: Math.round(S.zoom * 100) }))}</span>` : '';
  if (FULL && !running()) {
    middle = `<p class="hint">${esc(t('Every block in detail: select one on the page or in the tree.'))}</p>${zoom}`;
    actions = `<button type="button" class="btn${S.tray ? ' on' : ''}" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('{count} · close', { count }) : count)}</button>${hideBtn}`;
  } else if (fix?.isOpen()) {
    middle = `<div class="status" role="status"><span>${esc(t('Fixing by hand · {what}', { what: fix.what() }))}</span>${zoom}<button type="button" class="btn main" data-bar="done-fixing">${esc(t('Done, back to tasks'))}</button></div>`;
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
    middle = `<p class="hint">${esc(t('Click anything on the page and say what should change.'))}</p>${zoom}`;
    actions = `<button type="button" class="btn${S.tray ? ' on' : ''}" data-bar="tray" aria-expanded="${S.tray}">${esc(S.tray ? t('{count} · close', { count }) : count)}</button>
      <button type="button" class="btn main" data-bar="give" ${open.length ? '' : 'disabled'}>${esc(open.length === 1 ? t('Give it to Kaity') : t('Give them to Kaity'))}</button>
      <button type="button" class="btn" data-bar="undo" title="${esc(undoTitle)}" aria-label="${esc(undoTitle)}" ${S.canUndo ? '' : 'disabled'}>${esc(t('Undo'))}</button>${hideBtn}`;
  }
  const phone = S.phone ? `<button type="button" class="btn on" data-bar="full">${esc(t('375 px · back to full width'))}</button>` : '';
  bar.innerHTML = `${switcher}${modes}${middle}<div class="actions">${phone}${actions}</div>`;
}

bar.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-bar]')?.dataset.bar;
  if (!act) return;
  if (act === 'pages') return sidebar.toggle();
  if (act === 'tray') return S.tray ? closeTray() : ((S.stepsHidden = false), openTray());
  if (act === 'give') return giveKaity(openTasks().map((x) => x.n));
  if (act === 'hide') return hide();
  if (act === 'undo') return undo();
  if (act === 'full') return fullWidth();
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

/** "Over the page" or "Shrink the page to fit", at the top of both sidebars; the choice is remembered. */
const modeSwitch = () => `<div class="modesw" role="group" aria-label="${esc(t('The page beside this panel'))}">
  <button type="button" data-mode="over" aria-pressed="${S.mode === 'over'}">${esc(t('Over the page'))}</button>
  <button type="button" data-mode="shrink" aria-pressed="${S.mode === 'shrink'}">${esc(t('Shrink the page to fit'))}</button></div>`;
function setMode(m) {
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
  const panel = sidebar.isOpen() ? sidebar.el : fix?.isOpen() ? fix.el : null;
  const shrink = panel && S.mode === 'shrink' && !S.phone;
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

const sidebar = createSidebar({ page: PAGE, onChange: () => layoutStage(), modeSwitch, setMode, pageHref: (p) => shellOf(p) });
const closeMenu = () => sidebar.isOpen() && sidebar.close();

// ---------- fixing one thing by hand, and the box tree (fix.js) ----------

const fix = createFixPanel({
  api,
  frame,
  page: PAGE,
  tree: () => S.tree,
  blocks: () => [...S.blocks],
  pages: () => S.site?.pages ?? [PAGE],
  tasks: openTasks,
  siteKit: () => S.kit,
  modeSwitch,
  setMode,
  onChange: () => layoutStage(),
  onClose: () => layoutStage(),
  toTask: (spot) => {
    const el = frame.taskEl(spot.block, spot.path);
    if (el) openBox({ ...spot, el });
  },
  select(block) {
    const el = frame.blockEl(block);
    if (el) frame.show(el, 0);
    draw();
  },
  refreshTree: () => loadState(),
});

async function openFix(spot) {
  closeMenu();
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
    if (sidebar.isOpen()) return closeMenu();
    if (S.box) return closeBox();
    if (fix.isOpen()) return fix.close();
    if (S.trying) return doneTrying();
    if (S.phone) return fullWidth();
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

function openMenu(spot, x, y) {
  closeBox();
  closeMenu();
  menuSpot = spot;
  const what = spot.path ? plainLabel(spot.label) : t('the {block} box', { block: spot.block });
  const item = (act, label) => `<button type="button" role="menuitem" data-ctx="${act}">${esc(label)}</button>`;
  ctxMenu.innerHTML = `<p class="ctxhead"><b>${esc(spot.block)}</b> ${esc(what)}</p>
    ${item('task', t('Leave a task here…'))}
    ${item('hand', t('Fix it by hand'))}
    ${item('tree', t('Move, add or delete boxes'))}
    ${item('full', t('Open {block} in the full editor', { block: spot.block }))}
    <hr>${item('hide', t('Hide tykerf'))}`;
  // where the pointer is, in the window: the frame's place on the stage, at the page's zoom
  const f = $('.frame').getBoundingClientRect(), k = S.zoom || 1;
  ctxMenu.hidden = false;
  const left = Math.min(f.left + x * k, innerWidth - ctxMenu.offsetWidth - 8), top = Math.min(f.top + y * k, innerHeight - ctxMenu.offsetHeight - 8);
  Object.assign(ctxMenu.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
  $('[role=menuitem]', ctxMenu).focus();
}
const closeCtx = () => ((ctxMenu.hidden = true), (menuSpot = null));

ctxMenu.addEventListener('click', (e) => {
  const act = e.target.closest('[data-ctx]')?.dataset.ctx;
  const spot = menuSpot;
  if (!act || !spot) return;
  closeCtx();
  const el = frame.taskEl(spot.block, spot.path);
  if (act === 'task' && el) openBox({ ...spot, el });
  if (act === 'hand') openFix(spot);
  if (act === 'tree') openFix(spot).then(() => fix.tree(spot.block));
  if (act === 'full') location.assign(fullEditor(spot.block));
  if (act === 'hide') hide();
});
ctxMenu.addEventListener('keydown', (e) => {
  const items = [...ctxMenu.querySelectorAll('[role=menuitem]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') (e.preventDefault(), items[(i + 1) % items.length].focus());
  if (e.key === 'ArrowUp') (e.preventDefault(), items[(i - 1 + items.length) % items.length].focus());
  if (e.key === 'Escape') closeCtx();
});
document.addEventListener('pointerdown', (e) => !ctxMenu.hidden && !ctxMenu.contains(e.target) && closeCtx());

/** Arriving from a site screen: ?show=<box> shows that box, ?task=<box> opens a task on it (once). */
function arrive() {
  if (FULL) return;
  const q = new URLSearchParams(location.search);
  const show = q.get('show'), task = q.get('task');
  if (!show && !task) return;
  window.history.replaceState(null, '', location.pathname);
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
