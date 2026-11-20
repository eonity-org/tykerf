// New page (v4): one screen in the shared frame, with the ways to start as tabs. Describe it to Kaity asks five
// questions (each may be skipped) and shows the brief they make, which is exactly what she gets, editable; From a
// kind of page shows the choices beside a live preview that follows every change (Full size opens over this screen,
// never in a new tab); Copy a web page; Like a page of this site. The rail shows the new page as being set up.

import { $, esc, failed, kaityMark, request, t } from './common.js';
import { fileChip, readFiles, ACCEPT } from './composer.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TONES = () => [['professional', t('Professional')], ['warm', t('Warm')], ['bold', t('Bold')], ['minimal', t('Minimal')], ['playful', t('Playful')]];
/** A purpose's boxes in words, for "What must it include?" (the box's name when it isn't here). */
const SECTION_WORDS = () => ({
  intro: t('Intro'), offer: t('What it offers'), gallery: t('Pictures'), visit: t('Hours and location'), contact: t('Contact'),
  about: t('About'), path: t('Experience'), work: t('Work'), programme: t('Programme'), people: t('People'), venue: t('Venue'),
  questions: t('Questions'), signup: t('Sign-up'), what: t('What it does'), figures: t('Figures'), join: t('How to join'),
  how: t('How it works'), detail: t('A closer look'), pricing: t('Prices'), next: t('Next step'), article: t('The article'),
  more: t('More to read'), steps: t('Steps'),
});
const word = (box) => SECTION_WORDS()[box] ?? box.replace(/-/g, ' ');

/** The frames as small drawings: what holds the page. */
const WIRE = {
  simple: '<rect x="2" y="2" width="56" height="8" rx="1"/><rect x="2" y="13" width="56" height="25" rx="1" class="b"/>',
  basic: '<rect x="2" y="2" width="56" height="7" rx="1"/><rect x="2" y="12" width="56" height="20" rx="1" class="b"/><rect x="2" y="34" width="56" height="5" rx="1"/>',
  full: '<rect x="2" y="2" width="56" height="6" rx="1"/><rect x="2" y="10" width="56" height="6" rx="1" class="b2"/><rect x="2" y="18" width="11" height="14" rx="1"/><rect x="15" y="18" width="30" height="14" rx="1" class="b"/><rect x="47" y="18" width="11" height="14" rx="1"/><rect x="2" y="34" width="56" height="5" rx="1"/>',
};
const PREVIEW_W = { desktop: 1440, tablet: 768, phone: 375 };

let draft = null; // what the person has chosen and written, kept while the screen draws again

/** The brief Kaity gets, from the answers (the person may write over it). */
function assemble(d, kinds) {
  const kind = kinds.find((k) => k.name === d.kind);
  const lines = [];
  const what = kind ? t('A {kind} page', { kind: t(kind.label).toLowerCase() }) : d.kind === 'other' ? t('A page') : t('A page');
  lines.push(d.who.trim() ? `${what} ${t('for')} ${d.who.trim().replace(/\.$/, '')}.` : `${what}.`);
  if (d.sections.length) lines.push(t('Sections: {list}.', { list: d.sections.map((s) => s.toLowerCase()).join(', ') }));
  if (d.tone) lines.push(t('Tone: {tone}.', { tone: TONES().find(([k]) => k === d.tone)?.[1].toLowerCase() ?? d.tone }));
  if (d.more.trim()) lines.push(d.more.trim());
  if (d.files.length) lines.push(t('Attached: {files}', { files: d.files.map((f) => f.name).join(', ') }));
  return lines.join('\n');
}

export const newScreen = {
  title: () => t('New page'),
  async render(main, ctx) {
    const [site, lib, ai] = await Promise.all([request('/_tykerf/site'), request('/_tykerf/library'), request('/_tykerf/ai/status').catch(() => ({ ready: false, note: '' }))]);
    const { purposes, frames, frame: firstFrame, themes } = lib;
    const offered = themes.filter((x) => !x.retired);
    const taken = site.pages;
    const params = new URLSearchParams(location.search);
    const from = params.get('from');
    let n = taken.length + 1;
    while (taken.includes(`page-${n}`)) n++;
    const firstName = taken.length ? `page-${n}` : 'home';
    draft ??= {
      start: ['describe', 'kind', 'copy', 'like'].includes(params.get('start')) ? params.get('start') : 'describe',
      name: firstName, named: false,
      // Describe it to Kaity
      kind: purposes[0].name, who: '', sections: [], sectionsFor: null, extra: [], tone: 'professional', more: '', files: [], brief: '', briefEdited: false,
      // From a kind of page
      purpose: purposes[0].name, frame: firstFrame, side: false, shared: true, theme: site.sharedTheme ? 'site' : (offered.some((x) => x.name === 'studio') ? 'studio' : offered[0].name), device: 'desktop',
      // Copy a web page, Like a page
      url: '', structureOnly: false, like: taken.includes(from) ? from : taken.includes(site.home) ? site.home : taken[0] ?? '',
    };
    if (!taken.includes(draft.like)) draft.like = taken[0] ?? '';
    ctx.setPending?.(draft.name || '…');
    const P = () => purposes.find((x) => x.name === draft.purpose) ?? null;
    const F = () => frames.find((x) => x.name === draft.frame) ?? frames[0];
    const layoutName = () => (P() ? `${F().name}+${P().name}` : F().name);
    const sideOn = () => !!F().side?.length && draft.side;
    const previewURL = () => `/_tykerf/preview/${layoutName()}/${draft.theme === 'site' ? 'site' : encodeURIComponent(draft.theme)}/?side=${sideOn() ? 1 : 0}`;
    const kindDescribed = () => purposes.find((k) => k.name === draft.kind);
    /** The sections suggested for the kind chosen (all of its sections, ticked), unless the person changed them. */
    const suggest = () => {
      if (draft.sectionsFor === draft.kind) return;
      draft.sectionsFor = draft.kind;
      draft.sections = (kindDescribed()?.sections ?? []).map(word);
      draft.extra = [];
    };
    suggest();
    const brief = () => (draft.briefEdited ? draft.brief : (draft.brief = assemble(draft, purposes)));

    const tab = (k, icon, title, sub) => `<button type="button" class="nptab" role="tab" data-start="${k}" aria-selected="${draft.start === k}">${icon}<span><b>${esc(title)}</b><span>${esc(sub)}</span></span></button>`;
    const nameField = (id) => `<div class="np-name"><label class="fxlabel" for="${id}">${esc(t('Page name'))}</label>
      <input id="${id}" name="name" value="${esc(draft.name)}" spellcheck="false" autocomplete="off">
      <p class="note">${esc(t('Its address will be /{name}/.', { name: draft.name || '…' }))}${taken.length ? '' : ` ${esc(t('It becomes the home page.'))}`}</p></div>`;

    const describe = () => {
      const kind = kindDescribed();
      const all = [...new Set([...(kind?.sections ?? []).map(word), ...draft.extra])];
      return `<div class="np-two">
        <form class="np-q" data-np="kaity">
          <section><span class="qn">1</span><h2>${esc(t('What is the page?'))}</h2><p class="note">${esc(t('This picks the sections Kaity proposes below.'))}</p>
            <div class="chips">${purposes.map((x) => `<button type="button" class="chip" data-kind="${esc(x.name)}" aria-pressed="${draft.kind === x.name}">${esc(t(x.label))}</button>`).join('')}<button type="button" class="chip" data-kind="other" aria-pressed="${draft.kind === 'other'}">${esc(t('Something else'))}</button></div></section>
          <section><span class="qn">2</span><h2><label for="np-who">${esc(t('Who is it for, and what should they do?'))}</label></h2>
            <textarea id="np-who" name="who" rows="2" placeholder="${esc(t('e.g. Neighbours who want good bread. They should come to the shop, or order for the weekend.'))}">${esc(draft.who)}</textarea></section>
          <section><span class="qn">3</span><h2>${esc(t('What must it include?'))}</h2><p class="note">${esc(kind ? t('Suggested for a {kind} page. Untick what you do not need.', { kind: t(kind.label).toLowerCase() }) : t('Add the sections you want.'))}</p>
            <div class="chips">${all.map((s) => `<button type="button" class="chip" data-section="${esc(s)}" aria-pressed="${draft.sections.includes(s)}">${esc(s)}</button>`).join('')}
              <span class="addsec"><input name="newsection" placeholder="${esc(t('Add another'))}" aria-label="${esc(t('Another section'))}"><button type="button" class="chip" data-addsection>${esc(t('+ Add'))}</button></span></div></section>
          <section><span class="qn">4</span><h2>${esc(t('How should it sound?'))}</h2>
            <div class="chips">${TONES().map(([k, l]) => `<button type="button" class="chip" data-tone="${k}" aria-pressed="${draft.tone === k}">${esc(l)}</button>`).join('')}</div></section>
          <section><span class="qn">5</span><h2><label for="np-more">${esc(t('Anything else? Show her what you mean'))}</label></h2>
            <textarea id="np-more" name="more" rows="3" placeholder="${esc(t('e.g. Use the content of my CV, translated into Spanish. No top navigation: it is a one-page site.'))}">${esc(draft.more)}</textarea>
            <div class="np-attach" data-drop><button type="button" class="btn" data-attach>${esc(t('Attach files'))}</button><span class="note">${esc(t('PDF, images or a ZIP of a design · up to 5 · or drop them here'))}</span>
              ${draft.files.length ? `<div class="files">${draft.files.map((f, i) => fileChip(f, i)).join('')}</div>` : ''}</div></section>
          <section class="np-namerow">${nameField('np-name')}</section>
          <p class="np-error" role="alert" hidden></p>
        </form>
        <aside class="np-side">
          <div class="np-brief"><h2>${kaityMark(false, true)}${esc(t('What Kaity will get'))}</h2><p class="note">${esc(t('Built from your answers. Edit it if you like.'))}</p>
            <textarea name="brief" rows="12" aria-label="${esc(t('What Kaity will get'))}">${esc(brief())}</textarea>
            ${draft.briefEdited ? `<button type="button" class="link" data-rebuild>${esc(t('Build it again from my answers'))}</button>` : ''}
            <ol class="np-what"><li>${esc(t('Kaity picks the layout that fits, in the site\'s theme.'))}</li><li>${esc(t('The page opens at once; you see each step.'))}</li><li>${esc(t('Stop at any time, undo a step, or ask for more.'))}</li></ol></div>
          <button type="button" class="btn main big" data-go="kaity" ${ai.ready ? '' : 'disabled'}>${esc(t('Build it with Kaity'))}</button>
          <p class="note">${esc(ai.ready ? t('Uses your AI account and takes a few minutes.') : t('Kaity is not ready here: {note}', { note: ai.note ?? '' }))}</p>
        </aside></div>`;
    };

    const kindTab = () => {
      const p = P(), f = F();
      const themeCard = (x) => {
        const v = x.values ?? {};
        return `<button type="button" class="tcard" data-theme="${esc(x.name)}" aria-pressed="${draft.theme === x.name}" style="--tb:${esc(v['--color-bg'] ?? '#fff')};--tt:${esc(v['--color-text'] ?? '#111')};--ta:${esc(v['--color-accent'] ?? '#06c')};--tf:${esc(v['--font-heading'] ?? 'inherit')}"><span class="tsample"><b>Aa</b><i></i><i></i></span><span>${esc(t(x.label))}</span></button>`;
      };
      const siteCard = `<button type="button" class="tcard site" data-theme="site" aria-pressed="${draft.theme === 'site'}"><span class="tsample"><b>Aa</b><i></i><i></i></span><span>${esc(t('Site theme'))}</span></button>`;
      return `<div class="np-kind">
        <form class="np-controls" data-np="layout">
          <h2>${esc(t('1 · What the page is'))}</h2>
          <div class="chips">${purposes.map((x) => `<button type="button" class="chip" data-purpose="${esc(x.name)}" aria-pressed="${x.name === draft.purpose}">${esc(t(x.label))}</button>`).join('')}<button type="button" class="chip" data-purpose="" aria-pressed="${!p}">${esc(t('Just the frame'))}</button></div>
          <p class="note">${p ? `<b>${esc(t(p.label))}:</b> ${esc(t(p.description))}` : esc(t('An empty body to build in, section by section.'))}</p>
          <h2>${esc(t('2 · What holds it'))}</h2>
          <div class="fcards">${frames.map((x) => `<button type="button" class="fcard" data-frame="${esc(x.name)}" aria-pressed="${x.name === f.name}"><svg viewBox="0 0 60 41" aria-hidden="true">${WIRE[x.name] ?? WIRE.basic}</svg><b>${esc(t(x.label))}</b><span>${esc(t(x.name === 'simple' ? 'Just the page' : x.name === 'basic' ? 'Bar, page, footer' : 'With menus and aside'))}</span></button>`).join('')}</div>
          ${f.side?.length ? `<label class="check"><input type="checkbox" name="side" ${draft.side ? 'checked' : ''}> ${esc(f.side.includes('aside') ? t('With the side menu and the side note') : t('With the side menu'))}</label>` : ''}
          ${f.shared?.length && taken.length ? `<label class="check"><input type="checkbox" name="shared" ${draft.shared ? 'checked' : ''}> ${esc(t('Use the site\'s shared navigation and footer'))}</label>` : ''}
          <h2>${esc(t('3 · Theme'))}</h2>
          <div class="tcards">${site.sharedTheme ? siteCard : ''}${offered.map(themeCard).join('')}</div>
          ${site.sharedTheme && draft.theme !== 'site' ? `<p class="note warn">${esc(t('A page in another theme no longer matches the rest of the site.'))}</p>` : site.sharedTheme ? '' : `<p class="note">${esc(t('The site\'s pages share it. You can change the colours, fonts and spacing later.'))}</p>`}
          ${nameField('np-name2')}
          <p class="np-error" role="alert" hidden></p>
        </form>
        <section class="np-preview" aria-label="${esc(t('Live preview'))}">
          <header><h2>${esc(t('Live preview'))}</h2><span class="note">${esc([p ? t(p.label) : t('Just the frame'), t(f.label), draft.theme === 'site' ? t('Site theme') : t(offered.find((x) => x.name === draft.theme)?.label ?? draft.theme)].join(' · '))}</span>
            <div class="widths light" role="group" aria-label="${esc(t('Preview width'))}">${[['desktop', t('Desktop')], ['tablet', t('Tablet')], ['phone', t('Phone')]].map(([k, l]) => `<button type="button" data-pdevice="${k}" aria-pressed="${draft.device === k}">${esc(l)}</button>`).join('')}</div>
            <button type="button" class="btn small" data-fullsize>${esc(t('Full size'))}</button></header>
          <div class="pvbox" data-w="${PREVIEW_W[draft.device]}"><iframe class="pvframe" title="${esc(t('Live preview'))}" src="${previewURL()}"></iframe></div>
          <p class="note">${esc(t('Updates as you choose. Full size opens over this screen, never in a new tab.'))}</p>
        </section>
      </div>
      <footer class="np-foot"><p class="note">${esc(t('Sample text in a frame; change anything after.'))}</p>
        <button type="button" class="btn" data-go="fill" ${ai.ready ? '' : 'disabled'}>${esc(t('Then ask Kaity to fill it'))}</button>
        <button type="button" class="btn main" data-go="layout">${esc(t('Create {name} and open it', { name: draft.name || '…' }))}</button></footer>`;
    };

    const copyTab = () => `<form class="np-card wide" data-np="copy">
      <label class="fxlabel" for="np-url">${esc(t('Web address'))}</label>
      <input id="np-url" name="url" type="url" value="${esc(draft.url)}" placeholder="https://example.com" spellcheck="false" autocomplete="url">
      <label class="check"><input type="checkbox" name="structureOnly" ${draft.structureOnly ? 'checked' : ''}> ${esc(t('Only the layout: leave out the site\'s text, images and styles'))}</label>
      <p class="note">${esc(t('TYKERF opens the site in a browser and cuts the page into rows, columns and boxes. The copy is a starting point, not a perfect clone: check it at desktop and phone widths.'))}</p>
      <p class="note">${esc(t('A copy includes the site\'s text, images and design, which usually belong to someone else. Copy your own site to rebuild it; copy someone else\'s only to study or prototype, and publish it only with the owner\'s permission.'))}</p>
      ${nameField('np-name3')}
      <p class="np-error" role="alert" hidden></p>
      <div class="row"><button class="btn main" type="submit">${esc(t('Copy the page'))}</button></div></form>`;

    const likeTab = () => `<form class="np-card wide" data-np="like">
      <p class="note">${esc(t('Its navigation, footer and look, with one empty section between them for the new content. A page without a navigation and a footer is copied whole.'))}</p>
      <div class="chips">${taken.map((p) => `<button type="button" class="chip" data-like="${esc(p)}" aria-pressed="${p === draft.like}">${esc(p)}</button>`).join('')}</div>
      ${nameField('np-name4')}
      <p class="np-error" role="alert" hidden></p>
      <div class="row"><button class="btn main" type="submit">${esc(t('Create {name} like {page}', { name: draft.name || '…', page: draft.like }))}</button></div></form>`;

    const LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
    const DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>';
    const LIKE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/></svg>';
    const back = from && taken.includes(from) ? `/_tykerf/edit/${encodeURIComponent(from)}/` : '/_tykerf/edit/_site/';
    function draw() {
      main.innerHTML = `<div class="newpage">
        <header class="np-head"><h1>${esc(t('New page'))}</h1><a class="btn" href="${back}" data-cancel>${esc(t('Cancel'))}</a></header>
        <div class="nptabs" role="tablist" aria-label="${esc(t('How to start'))}">
          ${tab('describe', `<span class="kmark">${kaityMark(false, true)}</span>`, t('Describe it to Kaity'), t('Kaity builds it while you watch'))}
          ${tab('kind', LIST, t('From a kind of page'), t('Choose with a live preview'))}
          ${tab('copy', DOC, t('Copy a web page'), t('From an address'))}
          ${taken.length ? tab('like', LIKE, t('Like a page of this site'), t('Its navigation, footer and look')) : ''}
        </div>
        <div class="nppanel" role="tabpanel">${draft.start === 'describe' ? describe() : draft.start === 'kind' ? kindTab() : draft.start === 'copy' ? copyTab() : likeTab()}</div>
      </div>`;
      fitPreview();
    }

    /** The preview at the chosen width, shown at the room it has. */
    function fitPreview() {
      const box = $('.pvbox', main), f = $('.pvframe', main);
      if (!box || !f) return;
      const w = PREVIEW_W[draft.device], k = Math.min(1, box.clientWidth / w);
      Object.assign(f.style, { width: `${w}px`, height: `${Math.round(box.clientHeight / k)}px`, transform: `scale(${k})` });
    }
    /** A new choice: the preview follows without drawing the controls again where it can. */
    function previewAgain() {
      const f = $('.pvframe', main);
      if (f) f.src = previewURL();
    }

    function fullSize() {
      const d = document.createElement('div');
      d.className = 'fullsize';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-label', t('Full size preview'));
      d.innerHTML = `<div class="fsbar"><button type="button" class="btn" data-back>← ${esc(t('Back to choices'))}</button><span>${esc(t('Full size preview'))} · ${esc(layoutName())}</span></div><iframe title="${esc(t('Full size preview'))}" src="${previewURL()}"></iframe>`;
      document.body.append(d);
      const close = () => (d.remove(), $('[data-fullsize]', main)?.focus());
      d.querySelector('[data-back]').onclick = close;
      d.addEventListener('keydown', (e) => e.key === 'Escape' && close());
      d.querySelector('[data-back]').focus();
    }

    const error = (msg, field) => {
      for (const el of main.querySelectorAll('.np-error')) {
        el.hidden = !msg;
        el.textContent = msg ?? '';
      }
      if (msg) (field ?? $('.np-error', main)).scrollIntoView({ block: 'center' }), field?.focus();
    };
    const nameInput = () => main.querySelector('[name="name"]');

    async function create(kind) {
      const name = draft.name;
      if (!NAME.test(name)) return error(t('Use lowercase letters, digits and - for the name, starting with a letter or digit.'), nameInput());
      if (taken.includes(name)) return error(t('There is already a page called {name}.', { name }), nameInput());
      let body;
      if (kind === 'kaity') {
        const prompt = brief().trim();
        if (!prompt && !draft.files.length) return error(t('Say what the page should be, or attach a picture or a PDF of it.'), $('#np-who', main));
        body = { name, prompt, files: draft.files.map(({ name: n, type, data }) => ({ name: n, type, data })) };
      } else if (kind === 'copy') {
        if (!/^https?:\/\/[^\s/]+\S*$/i.test(draft.url.trim())) return error(t('Write the address of the page to copy, starting with https://'), $('#np-url', main));
        body = { name, url: draft.url.trim(), structureOnly: draft.structureOnly };
      } else if (kind === 'like') body = { name, like: draft.like };
      else body = { name, layout: layoutName(), side: sideOn(), shared: draft.shared, theme: draft.theme };
      for (const b of main.querySelectorAll('[data-go], [type="submit"]')) b.disabled = true;
      try {
        await request('/_tykerf/site/new', body);
        draft = null;
        ctx.setPending?.(null);
        location.assign(`/_tykerf/edit/${encodeURIComponent(name)}/${kind === 'fill' ? '?ask=page' : ''}`);
      } catch (err) {
        for (const b of main.querySelectorAll('[data-go], [type="submit"]')) b.disabled = false;
        error(err.message, kind === 'copy' ? $('#np-url', main) : null);
      }
    }

    async function attach(list) {
      try {
        draft.files.push(...(await readFiles(list, 5 - draft.files.length)));
      } catch (e) {
        failed(e);
      }
      draw();
    }

    draw();
    main.oninput = (e) => {
      const f = e.target;
      if (f.name === 'who' || f.name === 'more') {
        draft[f.name] = f.value;
        const b = $('[name="brief"]', main);
        if (b && !draft.briefEdited) b.value = brief();
      }
      if (f.name === 'brief') (draft.brief = f.value), (draft.briefEdited = true);
      if (f.name === 'url') {
        draft.url = f.value;
        if (!draft.named) {
          try {
            const nm = new URL(f.value.trim()).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
            if (nm) {
              draft.name = taken.includes(nm) ? `${nm}-copy` : nm;
              nameInput().value = draft.name;
              ctx.setPending?.(draft.name);
            }
          } catch {}
        }
      }
      if (f.name === 'name') {
        draft.named = true;
        draft.name = f.value.trim();
        ctx.setPending?.(draft.name || '…');
        for (const p of main.querySelectorAll('.np-name .note')) p.firstChild.textContent = t('Its address will be /{name}/.', { name: draft.name || '…' });
        const go = $('[data-go="layout"]', main);
        if (go) go.textContent = t('Create {name} and open it', { name: draft.name || '…' });
        const like = $('[data-np="like"] [type="submit"]', main);
        if (like) like.textContent = t('Create {name} like {page}', { name: draft.name || '…', page: draft.like });
      }
    };
    main.onchange = (e) => {
      const f = e.target;
      if (f.name === 'structureOnly') draft.structureOnly = f.checked;
      if (f.name === 'shared') draft.shared = f.checked;
      if (f.name === 'side') (draft.side = f.checked), previewAgain();
    };
    main.onclick = (e) => {
      const el = (sel) => e.target.closest(sel);
      if (el('[data-start]')) return (draft.start = el('[data-start]').dataset.start), draw();
      if (el('[data-kind]')) {
        draft.kind = el('[data-kind]').dataset.kind;
        suggest();
        return draw();
      }
      if (el('[data-section]')) {
        const s = el('[data-section]').dataset.section;
        draft.sections = draft.sections.includes(s) ? draft.sections.filter((x) => x !== s) : [...draft.sections, s];
        return draw();
      }
      if (el('[data-addsection]')) {
        const v = $('[name="newsection"]', main).value.trim();
        if (v && !draft.sections.includes(v)) (draft.extra.push(v), draft.sections.push(v));
        return draw();
      }
      if (el('[data-tone]')) {
        const k = el('[data-tone]').dataset.tone;
        draft.tone = draft.tone === k ? '' : k;
        return draw();
      }
      if (el('[data-rebuild]')) return (draft.briefEdited = false), draw();
      if (el('[data-attach]')) {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, multiple: true });
        input.onchange = () => attach([...input.files]);
        return input.click();
      }
      if (el('[data-unfile]')) return draft.files.splice(Number(el('[data-unfile]').dataset.unfile), 1), draw();
      if (el('[data-purpose]')) return (draft.purpose = el('[data-purpose]').dataset.purpose), draw();
      if (el('[data-frame]')) return (draft.frame = el('[data-frame]').dataset.frame), draw();
      if (el('[data-theme]')) return (draft.theme = el('[data-theme]').dataset.theme), draw();
      if (el('[data-pdevice]')) return (draft.device = el('[data-pdevice]').dataset.pdevice), draw();
      if (el('[data-fullsize]')) return fullSize();
      if (el('[data-like]')) return (draft.like = el('[data-like]').dataset.like), draw();
      if (el('[data-cancel]')) {
        draft = null;
        ctx.setPending?.(null);
        return;
      }
      const go = el('[data-go]')?.dataset.go;
      if (go) return create(go);
    };
    main.onsubmit = (e) => (e.preventDefault(), create(e.target.dataset.np));
    main.onkeydown = (e) => {
      if (e.target.name === 'newsection' && e.key === 'Enter') (e.preventDefault(), $('[data-addsection]', main).click());
    };
    const dropZone = (e) => e.target.closest?.('[data-drop]');
    main.ondragover = (e) => dropZone(e) && e.preventDefault();
    main.ondrop = (e) => dropZone(e) && (e.preventDefault(), attach([...e.dataTransfer.files]));
    main.onpaste = (e) => {
      if (draft.start !== 'describe') return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) (e.preventDefault(), attach(files));
    };
    newScreen.resize = fitPreview;
  },
};
