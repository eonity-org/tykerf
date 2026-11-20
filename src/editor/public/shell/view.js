// View mode (v4): the page as visitors see it, with one small pill at the bottom: tykerf · Viewing · the page
// switcher · Edit this page. It stays while the person follows links between the site's pages (a cookie the page's
// address reads, server.ts), until Edit (or Back to the site manager) turns it off. Drawn in its own shadow root, so
// the page's styles and the pill's never meet.

import { t } from './common.js';

const me = document.querySelector('script[src$="/_tykerf/shell/view.js"]');
const PAGE = decodeURIComponent(me?.dataset.page ?? location.pathname.split('/')[1] ?? '');
const off = (to) => `/_tykerf/view/off?next=${encodeURIComponent(to)}`;
const EDIT = off(`/_tykerf/edit/${encodeURIComponent(PAGE)}/`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const T = (x, v) => esc(t(x, v));

const host = document.createElement('tykerf-view');
host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:0;z-index:2147483647';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: tykerf-plex-sans, system-ui, sans-serif; }
  .pill { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 14px; border-radius: 999px; background: #0A5475; color: #fff; box-shadow: 0 10px 30px rgb(16 48 63 / .35); font-size: 14px; white-space: nowrap; }
  .brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 15px; }
  .brand svg { width: 20px; height: 20px; }
  .tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgb(255 255 255 / .16); }
  .tag svg, .edit svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; }
  button, a { font: inherit; color: inherit; cursor: pointer; text-decoration: none; }
  .switch { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border: 1px solid rgb(255 255 255 / .55); border-radius: 999px; background: none; color: #fff; }
  .edit { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; background: #EA9A27; color: #10303F; font-weight: 600; }
  :focus-visible { outline: 3px solid #EA9A27; outline-offset: 2px; }
  .edit:focus-visible { outline-color: #fff; }
  .menu { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); width: min(300px, calc(100vw - 24px)); max-height: 60vh; overflow: auto; padding: 10px; border: 1px solid #C6D7DE; border-radius: 12px; background: #fff; color: #10303F; box-shadow: 0 12px 32px rgb(16 48 63 / .2); }
  .menu[hidden] { display: none; }
  .menu h2 { margin: 2px 6px 8px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #2A5A70; }
  .menu a { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px; color: #10303F; }
  .menu a:hover, .menu a:focus-visible, .menu a[aria-current] { background: #E6F0F4; outline: none; }
  .home { padding: 0 6px; border-radius: 4px; background: #FCE6C3; color: #6B4508; font-size: 11px; font-weight: 600; line-height: 18px; text-transform: uppercase; }
  .menu hr { margin: 8px 4px; border: 0; border-top: 1px solid #C6D7DE; }
  .menu .back { color: #0A5475; font-weight: 600; justify-content: flex-start; }
  .menu p { margin: 6px 6px 2px; font-size: 13px; color: #2A5A70; }
  @media print { .pill, .menu { display: none; } }
</style>
<div class="menu" role="menu" hidden></div>
<div class="pill" role="toolbar" aria-label="${T('tykerf: viewing the site')}">
  <span class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="20" rx="6" fill="currentColor"/><rect y="26" width="30" height="38" rx="6" fill="currentColor" opacity=".7"/><rect x="34" y="26" width="30" height="38" rx="6" fill="currentColor" opacity=".45"/></svg>tykerf</span>
  <span class="tag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>${T('Viewing')}</span>
  <button type="button" class="switch" aria-haspopup="menu" aria-expanded="false">${esc(PAGE)} ▾</button>
  <a class="edit" href="${EDIT}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>${T('Edit this page')}</a>
</div>`;
document.body.append(host);

const menu = root.querySelector('.menu'), sw = root.querySelector('.switch');
async function openMenu() {
  let site = { pages: [PAGE], home: null };
  try {
    site = await (await fetch('/_tykerf/site')).json();
  } catch {}
  menu.innerHTML = `<h2>${T('Go to a page')}</h2>${site.pages.map((p) => `<a role="menuitem" href="/${encodeURIComponent(p)}/" ${p === PAGE ? 'aria-current="page"' : ''}><span>${esc(p)}</span>${p === site.home ? `<span class="home">${T('Home')}</span>` : ''}</a>`).join('')}
    <hr><a role="menuitem" class="back" href="${off('/_tykerf/edit/_site/')}">← ${T('Back to the site manager')}</a>
    <p>${T('Links on the page keep you in View mode until you press Edit.')}</p>`;
  menu.hidden = false;
  sw.setAttribute('aria-expanded', 'true');
  menu.querySelector('a')?.focus();
}
const closeMenu = () => ((menu.hidden = true), sw.setAttribute('aria-expanded', 'false'));
sw.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) return closeMenu(), sw.focus();
  if (e.altKey && e.shiftKey && e.code === 'KeyT') (e.preventDefault(), location.assign(EDIT));
});
addEventListener('pointerdown', (e) => !menu.hidden && !e.composedPath().includes(host) && closeMenu());
