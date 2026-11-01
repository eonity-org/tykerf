// The page chooser: the start screen of a new site and the editor's "New page…" dialog. A page starts
// in one of four ways:
//   - "Show or describe it": words, pictures and/or a design export (.zip); TYKERF makes a nearly empty page and the AI builds it
//     (the editor then opens on the page's AI tab, where the work shows as it happens);
//   - "Like this page" (New page… only): another page's navigation, footer and theme;
//   - "A layout": a page layout and a theme, with a live preview of the pair (the server renders
//     it in a sandboxed frame: no scripts, no access to the editor);
//   - "A copy of a website": the importer, with the copying advice.
// In a site whose pages share one theme, the theme choice is replaced by that theme.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Kaity's symbol (BRAND.md): the three balls of eonity's isotype, in the logo's blues
const KAITY_MARK = '<svg class="kaity-mark" viewBox="-0.25 -0.125 20.5 10.25" aria-hidden="true"><circle cx="15.3" cy="5" r="4.5" fill="#1A5D7D"/><circle cx="8.1" cy="5" r="3.6" fill="#287C9C"/><circle cx="2.7" cy="5" r="2.7" fill="#5295B3"/></svg>';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 3;
const MAX_IMAGE = 5 * 1024 * 1024;
// a design export (Google Stitch and the like): TYKERF reads its pictures and text files for Kaity
const MAX_ZIP = 8 * 1024 * 1024;
const isZip = (f) => /\.zip$/i.test(f.name) || ['application/zip', 'application/x-zip-compressed'].includes(f.type);

const base64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(file);
});

/**
 * Fill `root` with the chooser. `t` translates (English text as the key). `onCreate(choice)` makes the
 * page and may throw (its message is shown); the choice is `{ name, layout, theme }`, `{ name, url,
 * structureOnly }` (a copy), `{ name, prompt, images, zip, theme }` (for the AI; `zip` is `{ name, data }` or absent) or `{ name, like }`.
 * `like` names the page "Like this page" copies; `sharedTheme` says the site's pages share one theme;
 * `onCancel`, when given, adds Cancel.
 */
/**
 * `stepwise`: no way to start is chosen at first; choosing one opens its steps, its preview and the button,
 * so the form grows step by step (the site's home).
 */
export async function renderChooser(root, { t, name = 'home', taken = [], like = null, sharedTheme = false, stepwise = false, onCreate, onCancel }) {
  const [{ layouts, themes }, ai] = await Promise.all([
    fetch('/_tykerf/library').then((r) => r.json()),
    fetch('/_tykerf/ai/status').then((r) => r.json()).catch(() => ({ ready: false, note: '' })),
  ]);
  const st = {
    name, from: stepwise ? null : ai.ready ? 'idea' : 'layout', images: [], zip: null, named: false, width: 1440,
    layout: layouts.some((p) => p.name === 'launch') ? 'launch' : layouts[0].name,
    theme: themes.some((th) => th.name === 'studio') ? 'studio' : themes[0].name,
    ideaTheme: 'auto', // Kaity picks one that fits, unless the user does
  };
  const theme = () => (st.from === 'idea' ? st.ideaTheme : st.theme);
  const swatch = (v) => ['--color-bg', '--color-text', '--color-accent'].map((k) => `<i style="background:${esc(v[k] ?? '#fff')}"></i>`).join('');
  // a numbered step: one step 3 shows at a time, for the way chosen in step 2
  const step = (n, text) => `<span class="ch-step" aria-hidden="true">${n}</span>${text}`;
  const way = (from, title, text, badge = '') => `<button type="button" data-from="${from}" aria-pressed="${st.from === from}"><b>${title}${badge ? ` <em>${KAITY_MARK}${badge}</em>` : ''}</b><span>${text}</span></button>`;
  const themeChoice = sharedTheme
    ? `<p class="ch-explanation">${t('The pages of this site share one theme; this page will use it too. Change it in the Page tab of any page.')}</p>`
    : `<div class="ch-themes"><button type="button" class="ch-auto" data-for="idea" data-theme="auto" aria-pressed="true" title="${t('Kaity picks the theme that fits your words, pictures or design.')}">${KAITY_MARK}${t('Kaity chooses')}</button>${themes.map((th) => `
          <button type="button" data-theme="${esc(th.name)}" aria-pressed="${th.name === st.theme}" title="${esc(t(th.description))}"><span class="sw">${swatch(th.values)}</span>${esc(t(th.label))}</button>`).join('')}</div>
          <p class="ch-hint">${t('You can change the colours, fonts and spacing later in the Page tab.')}</p>`;
  const runner = `${esc(ai.runner === 'claude-code' ? 'Claude Code' : ai.runner === 'anthropic' ? t('Anthropic API') : ai.runner === 'gemini' ? t('Gemini API') : ai.runner ?? '')}${ai.model ? ` · ${esc(ai.model)}` : ''}`;
  root.innerHTML = `
    <form class="chooser" novalidate>
      <div class="ch-side">
        <label class="ch-field"><span>${step(1, t('Page name'))}</span><input name="name" value="${esc(st.name)}" spellcheck="false" autocomplete="off"></label>
        <p class="ch-hint">${t('Lowercase letters, digits and -. It is the folder of the page and its address in the editor.')}</p>
        <fieldset><legend>${step(2, t('How do you want to start?'))}</legend><div class="ch-ways">
          ${way('idea', t('Show or describe it'), t('Drop a screenshot or a sketch, or write what you want. Kaity builds the page while you watch.'), 'Kaity')}
          ${like ? way('like', t('Like this page'), t('The navigation, footer and theme of {page}, with an empty section in between.', { page: `<b>${esc(like)}</b>` })) : ''}
          ${way('layout', t('A layout'), t('Pick a structure of blocks and a theme, then change anything.'))}
          ${way('website', t('A copy of a website'), t('TYKERF copies a page from its address.'))}
        </div></fieldset>
        <div class="ch-idea" data-for="idea">
          <p class="ch-step-head">${step(3, t('Show it, describe it, or both'))}</p>
          <div class="ch-field"><span>${t('Show it')}</span>
            <div class="ch-drop" tabindex="0" role="button" aria-label="${t('Add images')}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>
              <span>${t('Drop, paste or {choose} up to 3 images (a screenshot of a page you like, a sketch, a mock-up) or a design exported as a ZIP file.', { choose: `<u>${t('choose')}</u>` })}</span>
              <div class="ch-pics"></div>
              <input type="file" accept="${[...IMAGE_TYPES, '.zip', 'application/zip'].join(',')}" multiple hidden>
            </div></div>
          <label class="ch-field"><span>${t('Describe it')}</span><textarea name="prompt" rows="5" placeholder="${t('e.g. A launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map')}"></textarea></label>
          <p class="ch-hint">${t('Either one is enough; both together work best.')}</p>
          <p class="ch-ai ${ai.ready ? 'ok' : 'bad'}">${ai.ready ? t('Kaity builds the page with {runner}. It uses your AI account and takes a few minutes; you can stop it or undo any step.', { runner }) : `${t('Kaity is not ready here: {note}', { note: esc(ai.note ?? '') })} ${t('Start from a layout or a copy of a website instead, and ask Kaity later.')}`}</p>
        </div>
        <div class="ch-site" data-for="website">
          <p class="ch-step-head">${step(3, t('The page to copy'))}</p>
          <label class="ch-field"><span>${t('Web address')}</span><input name="url" type="url" placeholder="https://example.com" spellcheck="false" autocomplete="url"></label>
          <label class="ch-check"><input type="checkbox" name="structureOnly"> ${t('Only the layout: leave out the site\'s text, images and styles')}</label>
          <div class="ch-advice"><b>${t('Copying a website')}</b>
            <p>${t('TYKERF opens the site in a browser and cuts the page into rows, columns and boxes. The copy is a starting point, not a perfect clone: check it at desktop and phone widths.')}</p>
            <p>${t('A copy includes the site\'s text, images and design, which usually belong to someone else. Copy your own site to rebuild it; copy someone else\'s only to study or prototype, and publish it only with the owner\'s permission.')}</p></div>
        </div>
        <fieldset data-for="layout"><legend>${step(3, t('Pick a layout'))} <span class="ch-legend-explanation">${t('ready-made pages to start from (templates)')}</span></legend><div class="ch-cards">${layouts.map((p) => `
          <button type="button" data-layout="${esc(p.name)}" aria-pressed="${p.name === st.layout}"><b>${esc(t(p.label))}</b><span>${esc(t(p.description))}</span></button>`).join('')}</div></fieldset>
        <fieldset data-for="layout idea"><legend>${step(4, t('Choose a theme'))}</legend>${themeChoice}</fieldset>
        <p class="ch-error" role="alert" hidden></p>
        <p class="ch-status" role="status" hidden></p>
        <div class="ch-actions" data-for="idea like layout website">${onCancel ? `<button type="button" data-ch="cancel">${t('Cancel')}</button>` : ''}<button type="submit" class="primary"></button></div>
      </div>
      <div class="ch-preview ch-panel" data-for="none">
        <div><b>${t('How do you want to start?')}</b><p>${t('Choose a way on the left: its steps open there, one after the other.')}</p></div>
      </div>
      <div class="ch-preview ch-panel" data-for="website">
        <div data-busy="false"><b>${t('A copy of a web page')}</b><p>${t('Write its address and choose Copy the page. The copy opens in the editor, ready to change like any other page.')}</p></div>
        <div data-busy="true" hidden><b class="spin">${t('Copying the page…')}</b><p>${t('TYKERF is opening the site, measuring it at desktop and phone widths and cutting it into blocks. This usually takes under a minute.')}</p></div>
      </div>
      <div class="ch-preview ch-panel" data-for="idea">
        <div data-busy="false"><b>${t('What happens')}</b><ol>
          <li>${t('Kaity picks the layout that fits best, and the theme unless you choose one.')}</li>
          <li>${t('The page opens at once, with a window showing each step as Kaity builds it from your words and pictures.')}</li>
          <li>${t('Everything it does is a normal change: stop it at any time, undo a step, or ask for more in the same conversation.')}</li></ol></div>
        <div data-busy="true" hidden><b class="spin">${t('Making the page…')}</b><p>${t('The page opens in a moment, with Kaity at work.')}</p></div>
      </div>
      <div class="ch-preview" data-for="layout like">
        <div class="ch-bar"><span>${t('Preview')}</span><span class="ch-seg"><button type="button" data-width="1440" aria-pressed="true">${t('Desktop')}</button><button type="button" data-width="375" aria-pressed="false">${t('Phone')}</button></span></div>
        <div class="ch-frame"><iframe sandbox title="${t('Preview')}"></iframe></div>
      </div>
    </form>`;
  const form = root.querySelector('.chooser');
  const frame = root.querySelector('iframe');
  const box = root.querySelector('.ch-frame');
  const error = root.querySelector('.ch-error');
  const submit = form.querySelector('[type=submit]');
  const status = form.querySelector('.ch-status');
  const pics = form.querySelector('.ch-pics');
  const fileInput = form.querySelector('.ch-drop input');
  const show = () => {
    const src = st.from === 'like' ? `/${encodeURIComponent(like)}/` : `/_tykerf/preview/${encodeURIComponent(st.layout)}/${sharedTheme ? 'site' : encodeURIComponent(st.theme)}/`;
    if (frame.getAttribute('src') !== src) frame.src = src;
  };
  // the page at its real width, scaled down to fit
  const fit = () => {
    const k = Math.min(1, box.clientWidth / st.width);
    Object.assign(frame.style, { width: `${st.width}px`, height: `${box.clientHeight / k}px`, transform: `scale(${k})` });
  };
  new ResizeObserver(fit).observe(box);
  const press = (sel, attr, v) => form.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', b.dataset[attr] === String(v)));
  const busy = (on) => form.querySelectorAll('[data-busy]').forEach((el) => (el.hidden = el.dataset.busy !== String(on)));
  const LABEL = { idea: t('Build it with Kaity'), like: t('Create the page'), layout: t('Create the page'), website: t('Copy the page') };
  const setFrom = (from) => {
    st.from = from;
    press('[data-from]', 'from', from);
    press('[data-theme]', 'theme', theme());
    form.querySelectorAll('[data-for]').forEach((el) => (el.hidden = !el.dataset.for.split(' ').includes(from ?? 'none')));
    busy(false);
    if (!from) return;
    submit.textContent = LABEL[from];
    submit.disabled = from === 'idea' && !ai.ready;
    error.hidden = true;
    if (from === 'website') form.elements.url.focus();
    if (from === 'idea') form.elements.prompt.focus();
    if (from === 'layout' || from === 'like') show(), fit();
  };

  // pictures and a design ZIP for the AI: dropped, pasted or chosen; kept as base64 until the page is made
  const renderPics = () => {
    pics.innerHTML = st.images.map((a, i) => `<span><img src="data:${a.mediaType};base64,${a.data}" alt=""><button type="button" data-unpic="${i}" aria-label="${t('Remove this image')}">×</button></span>`).join('')
      + (st.zip ? `<span class="ch-zip" title="${esc(st.zip.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M11 4h2M11 7h2M11 10h2M10 13h4v4h-4z"/></svg><b>${esc(st.zip.name)}</b><button type="button" data-unzip aria-label="${t('Remove the ZIP file')}">×</button></span>` : '');
  };
  const addFiles = async (files) => {
    for (const f of files) {
      if (isZip(f)) {
        if (f.size > MAX_ZIP) return void ((error.hidden = false), (error.textContent = t('The ZIP file is larger than 8 MB.')));
        st.zip = { name: f.name, data: await base64(f) }; // one at a time: a new one replaces it
        continue;
      }
      if (st.images.length >= MAX_IMAGES) return void ((error.hidden = false), (error.textContent = t('Up to 3 images.')));
      if (!IMAGE_TYPES.includes(f.type)) continue;
      if (f.size > MAX_IMAGE) return void ((error.hidden = false), (error.textContent = t('An image is larger than 5 MB.')));
      st.images.push({ mediaType: f.type, data: await base64(f) });
    }
    error.hidden = true;
    renderPics();
  };
  const drop = form.querySelector('.ch-drop');
  drop.addEventListener('click', (e) => !e.target.closest('[data-unpic], [data-unzip]') && fileInput.click());
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click()));
  fileInput.addEventListener('change', () => addFiles([...fileInput.files]).then(() => (fileInput.value = '')));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  });
  form.addEventListener('paste', (e) => {
    if (st.from !== 'idea') return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
    if (files.length) e.preventDefault(), addFiles(files);
  });

  form.elements.name.addEventListener('input', () => (st.named = true));
  // a copy is named after the site until the name is changed by hand
  form.elements.url.addEventListener('input', () => {
    if (st.named) return;
    try {
      const host = new URL(form.elements.url.value.trim()).hostname.replace(/^www\./, '');
      const n = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (n) form.elements.name.value = taken.includes(n) ? `${n}-copy` : n;
    } catch {}
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.from) setFrom(b.dataset.from);
    if (b.dataset.layout) (st.layout = b.dataset.layout), press('[data-layout]', 'layout', st.layout), show();
    if (b.dataset.theme) (st.from === 'idea' ? (st.ideaTheme = b.dataset.theme) : (st.theme = b.dataset.theme)), press('[data-theme]', 'theme', theme()), show();
    if (b.dataset.width) (st.width = +b.dataset.width), press('[data-width]', 'width', st.width), fit();
    if (b.dataset.unpic) st.images.splice(+b.dataset.unpic, 1), renderPics();
    if (b.dataset.unzip !== undefined) (st.zip = null), renderPics();
    if (b.dataset.ch === 'cancel') onCancel?.();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled || !st.from) return;
    const n = form.elements.name.value.trim();
    const url = form.elements.url.value.trim();
    const prompt = form.elements.prompt.value.trim();
    const why = !NAME.test(n) ? t('Use lowercase letters, digits and - for the name, starting with a letter or digit.')
      : taken.includes(n) ? t('There is already a page called {name}.', { name: n })
      : st.from === 'website' && !/^https?:\/\/[^\s/]+\S*$/i.test(url) ? t('Write the address of the page to copy, starting with https://')
      : st.from === 'idea' && !prompt && !st.images.length && !st.zip ? t('Write what the page should be, or add an image of it.')
      : null;
    error.hidden = !why;
    error.textContent = why ?? '';
    if (why) {
      const field = !NAME.test(n) || taken.includes(n) ? form.elements.name : st.from === 'website' ? form.elements.url : form.elements.prompt;
      return field.focus();
    }
    submit.disabled = true;
    const slow = st.from === 'website' || st.from === 'idea';
    if (slow) {
      busy(true);
      status.hidden = false;
      status.textContent = st.from === 'website' ? t('Copying the page…') : t('Making the page…');
    }
    try {
      await onCreate(
        st.from === 'website' ? { name: n, url, structureOnly: form.elements.structureOnly.checked }
        : st.from === 'idea' ? { name: n, prompt, images: st.images, ...(st.zip ? { zip: st.zip } : {}), ...(sharedTheme || st.ideaTheme === 'auto' ? {} : { theme: st.ideaTheme }) }
        : st.from === 'like' ? { name: n, like }
        : { name: n, layout: st.layout, ...(sharedTheme ? {} : { theme: st.theme }) });
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      submit.disabled = false;
      status.hidden = true;
      busy(false);
    }
  });
  setFrom(st.from);
  show();
  fit();
  form.elements.name.focus();
  form.elements.name.select();
}

/**
 * After a page is made: open it with TYKERF's panel on, and when the AI is building it, on the AI tab of
 * the block it works on. `j` is the answer of POST /_tykerf/site/new.
 */
export function openMadePage(j) {
  try {
    localStorage.setItem('tykerf.on', 'true');
    if (j.select) sessionStorage.setItem('tykerf.resume', JSON.stringify({ sel: j.select, tab: 'ai' }));
  } catch {}
  location.href = j.url;
}
