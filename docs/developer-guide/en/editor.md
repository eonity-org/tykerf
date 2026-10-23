<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **The editor**
<!-- /tykerf:header -->

# The editor

The editor is a small HTTP server (`src/editor/server.ts`, `src/editor/page.ts`) and a browser client with no build step (`src/editor/public/`). It serves each page exactly as it renders, plus one script, `tykerf.js`. That script draws the whole panel inside a shadow root, so the site's CSS and the editor's CSS never touch.

**The browser never edits the tree.** It asks the server for named operations, and the server runs them through the same core library the MCP server uses, as author `user`. People and the AI work on one tree and one history.

## The server

`npm start -- <folder> [--port 4400] [--host <addr>] [--layout t --theme th]`

A folder is either one page (it has `layout.slice`) or a site (`siteKind`):
- **A page** is served at `/` by one page host.
- **A site** serves each page at `/<page>/`, with a host per page made on first use (`hostOf`). The site manager is `public/start.html`, at `/_tykerf/site/` (and at `/` until the site has a home page in `site.json`: then `/` redirects there). `/pages/` is `siteIndex` and `/sitemap.xml` `siteMap` (with `TYKERF_PUBLIC_URL`). The manager shows the site's pages (open, rename and remove through `/_tykerf/site/rename` and `/site/remove`), the removed ones (`GET /_tykerf/site/trash`, `trashedPages`; **Empty the trash**: `POST /site/trash/empty`, `emptyTrash`) and **+ New page**, which opens the chooser with `stepwise` (no way chosen at first; choosing one opens its steps, preview and button). On a new site, only the chooser, as before. A removed page's open tabs go there too. `GET /_tykerf/site` also says what Kaity is doing (`kaity: {site, pages: [{page, block}]}`), which the manager lists; a page opens on a block and tab with `?block=<name>&tab=<tab>` (tykerf.js reads it and cleans the address).
- **A folder that changes.** An empty folder starts as a new site, but the MCP server or the command line may make a page right in it: `followFolder()` (on every request) then serves it as a page. The start screen asks `/_tykerf/site` every 2 seconds: it reloads when the folder became a page, and lists the pages made in it meanwhile.

`.env` is loaded from the working folder and the site or page folder. `runnerFromEnv()` then picks the AI runner once for the whole server.

### Global endpoints (`serveGlobal`)

| Endpoint | What it does |
|---|---|
| `GET /_tykerf/library` | Page layouts and theme presets, for the chooser |
| `GET /_tykerf/preview/<layout>/<theme>/` | A layout rendered in a `MemoryStore`, sandboxed (`<theme>` = `site`: with the site's shared theme) |
| `GET /_tykerf/site` | `kind`, `pages`, `sharedTheme`, `home`, `titles` |
| `POST /_tykerf/site/new` | A new page: `{name, layout, theme}`, `{name, url}` (a copy), `{name, like}` (like another page) or `{name, prompt, images, zip, theme}` (the AI builds it; `zip` is a design export `{name, data}`: answers with `select`, the block to open on). A copy and an AI build answer at once and run as the page's **job** (below) |
| `POST /_tykerf/site/rename`, `/site/remove`; `GET /site/links` | Rename a page (links follow) or move it to `.trash/`; refused while any page's AI runs. The links between pages (the manager's *Links between pages*) |
| `GET /favicon.<ext>`; `GET`/`POST /_tykerf/site/icon` | The site's icon (`siteIcon` in `site.ts`: `favicon.svg/png/ico` at the site root, else `madeIcon`), served to visitors too; `{type, data}` (base64) sets it, `{}` goes back to the made one. Pages link to it through `SiteLink.icon()`, which `Workspace.page()` puts first in the head. TYKERF's mark is `/_tykerf/favicon.svg`: its own screens use it, and `tykerf.js` swaps a page's icon for it while editing |
| `POST /_tykerf/site/duplicate` | `{name, to?}`: a copy of the page (`duplicatePage`: without its history, chats or `out/`), named `<name>-copy` when `to` is missing; refused while Kaity works on it |
| `GET/POST /_tykerf/site/head`, `POST /site/head/undo`, `/site/theme/share` | The site's shared theme, its undo, and turning one page's theme into the site's |
| `POST /_tykerf/site/home {name}`, `/site/title {name, title}` | The home page and a page's own title, in `site.json` |
| `GET/POST /_tykerf/site/code` | *Styles & scripts*: the site head without its theme and fonts blocks (`siteCode`/`setSiteCode`) |
| `GET /_tykerf/site/trash`, `POST /site/trash/empty` | The removed pages, and deleting them for good |
| `GET /_tykerf/site/chat`, `/site/events`; `POST /site/ask`, `/site/ask/cancel`, `/site/chat/reset` | Kaity for the whole site ([ai-and-mcp.md](ai-and-mcp.md#kaity-for-the-whole-site)) |
| `GET /pages/`, `/sitemap.xml` | The list of pages (`siteIndex`: title, address, the home page marked; a footer with the TYKERF mark and the way to sign in or to the manager) and the sitemap (with `TYKERF_PUBLIC_URL`) |
| `GET/POST /_tykerf/login`, `POST /_tykerf/logout` | Signing in when `TYKERF_ADMIN_PASSWORD` is set (`auth.ts`) |
| `GET /_tykerf/version` | Whether the server's code changed since it started (the restart notice) |
| `GET /_tykerf/site/publish`, `POST /site/publish/settings {settings}`, `POST /site/publish` | Publish (`src/publish.ts`): where to (`site.json` `publish`), whether `TYKERF_GITHUB_TOKEN` is set (never the token), the last publish (`.tykerf/published.json`); the publish itself, refused while Kaity works (409) |
| `GET /assets/*` | The site's own files (the shared theme's fonts) |
| `GET /_tykerf/export/report`, `/_tykerf/export.zip[?links=files][&page=<name>]` | What an export holds, and the export itself: the page or the whole site, or with `page` one page of the site (404 for a name that isn't a page) |
| `GET /_tykerf/ai/status`, `POST /_tykerf/ai/test` | Which runner and model answer, whether it's ready (never a key), and one tiny real request |

### One page's endpoints (`createPageHost` in `page.ts`)

Paths are relative to the page: `/_tykerf/…` for a single page, `/<page>/_tykerf/…` in a site.

| Endpoint | What it does |
|---|---|
| `GET /` | The page as it renders, plus `<script src="_tykerf/tykerf.js">` |
| `GET /assets/*` | The page's images and files (sandboxed CSP, nosniff) |
| `GET /_tykerf/state` | The panel's tree, the layout, the AI's run, the runner, undo and redo labels, the head version, the site's pages |
| `GET /_tykerf/events` | Server-sent events: `changed` (refresh), `ai` (a run's steps and answer), `moved` (the page was renamed or removed) |
| `POST /_tykerf/op` | A named operation (`OPS`): `insert`, `add`, `flip`, `ungroup`, `reorder`, `rename`, `ratios`, `height`, `width`, `look` (band tone and density: the `tone-*` and `dense` tags, one step), `delete`, `remove`, `paste`, `drop`, `component`, `section` |
| `GET/POST /_tykerf/box`, `GET /_tykerf/page` | One box's code (content and style apart), and the rendered parts |
| `GET/POST /_tykerf/head` | The page's head, whether its theme is the site's (`sharedTheme`), its own values over it (`overrides`) and whether it keeps its own look (`ownLook`) |
| `POST /_tykerf/head/override` | This page's own theme values over the site theme (`{values}`: only those that differ; `{}` follows the site again); checked like theme values, one undo step |
| `POST /_tykerf/asset`, `/asset/fetch`; `GET /assets`, `/asset/origin` | Images from the image tool or copied from another server, the page's images, and where a cropped image came from |
| `POST /_tykerf/undo`, `/redo` | One step; refused (409) while the AI runs |
| `POST /_tykerf/import` | Copy a page and list its sections, for *Import a section* (token-checked `section` op) |
| `POST /_tykerf/ask`, `/ask/cancel`, `/chat/reset`; `GET /chat`, `/image/<file>` | The AI conversation of a block |
| `GET /_tykerf/job`; `POST /_tykerf/job/stop`, `/job/seen` | The page's background job (a copy, or the AI building the page): its steps and how it ended; stop it; forget it once seen. Changes stream as the SSE `job` event |

Every operation runs inside `ws.transaction()`, then broadcasts `changed`. Changes from outside (the AI's MCP process, a text editor) reach open pages through the store's watcher.

### Code updates

The client files in `public/` are read from disk on every request, but the server process keeps the TypeScript it started with. `codeStamp()` (server.ts) fingerprints `src/**/*.ts` (count, sizes, latest change) at startup; `GET /_tykerf/version` says whether it differs now. `tykerf.js` and `start.html` ask on load and when the tab comes back, and show a restart notice when it does, or when the address is missing (a server older than this check).

### Security

- The server listens on `127.0.0.1` by default.
- `foreign()` refuses:
  - other `Host` headers (against DNS rebinding);
  - changes from other origins, or without a JSON body (against cross-site requests).
- Every state-changing endpoint must stay behind `foreign()`.
- Page files are served with `Content-Security-Policy: sandbox`, and uploads are checked by their bytes.
- Box scripts run in the editor's own page and origin, so they can call the API too. That is a documented, accepted risk, explained in [SECURITY.md](../../../SECURITY.md).

## The browser client

`public/` holds plain ES modules, served as they are:

| File | What it holds |
|---|---|
| `tykerf.js` | The panel: state (`S`), the tree, the tabs (Blocks, Text, Code, Size, Page, AI), editing text and images in place, the page list, the Site menu (export, AI status), popovers, refreshes |
| `inline.js` | Pure helpers for editing in place (mapping an element to its box code, cleaning what the browser typed); tested in `test/inline.test.ts` |
| `chooser.js` + `chooser.css` | The start screen and *New page…*: *Show or describe it*, *Like this page*, *A layout*, *A copy of a website*; `openMadePage` opens a new page (on its AI tab when the AI builds it) |
| `start.html` | The site's home: its pages (open, rename, remove) and the chooser for a new one; the start screen of a new site |
| `fonts/`, `brand/`, `i18n/` | IBM Plex (bundled, SIL OFL), the logo, translations |

How the client works:
- **API base.** `tykerf.js` derives it from `location.pathname`, so the same client works at `/` and at `/<page>/`.
- **Per-block state.** Each block keeps its own tab, unsaved drafts and AI draft (`per(id)`).
- **A page being made.** On load and on the `job` event, `renderJob` shows a modal over the page with the job's steps: the importer's stages (`onStep`, English sentences translated with `t()`), or the AI's tool calls. It has an × (stop) and, at the end, a short guide with *Open the editor* / *See the page*. The modal blocks the page, so nothing disturbs the AI.
- **How the job modal looks.** While it shows, the panel and the Edit button are hidden; the TYKERF logo and the × head it, with Kaity's line under them, smaller. Steps come short from `step()` in `ai.ts` and wrap, never clipped (Chrome garbles clipped lines in that scrolled list). A running job is a small card in the bottom right corner over a light veil (`.jobmodal.running`), so the page coming together is what people watch; at the end it returns to the middle.
- **A page coming into focus.** While Kaity builds a page, `state().build` lists the boxes with sample content left (`leftovers`), apart in `strong` (not reached yet) and `soft` (changed since the last whole-page step: `Workspace.boxesWorkedOn`). `applyFocus()` writes them as blur rules in a `<style id="tykerf-focus">` in the page's head; `refocus()` applies new rules a frame after the body is replaced, so a finished box sharpens with its transition. *See the page clearly* turns it off; the end of the job clears it.
- **Refreshes.** A `changed` event reloads the state and the page's body. A change of head reloads the whole page, because a head can't be swapped in place. Refreshes wait while text is being edited or the image tool is open.
- **Text.** Every string a person sees goes through `t('English text', vars)`, with whole sentences as keys (see [Extending TYKERF](extending.md#a-translation)).
- **Fonts.** The panel's fonts are declared in `document.head` under TYKERF-only names (`@font-face` doesn't work inside a shadow root) and served by TYKERF. Nothing loads from a CDN.

### Editing in place

`tykerf.js` does the editing, with the pure helpers in `public/inline.js`.
- **Mapping.** An edit maps a page element to the box code by its element path (skipping `style`/`script`/`template`), and only when the code there has the same markup as the element had when the edit started. Otherwise it falls back to the Text tab.
- **Text** edits are limited to inline-only elements (text, `br`, `strong/b/em/i/a`). `cleanInline` keeps the elements that existed before the edit as they were, and allows only `strong`, `em`, `a[href]` (safe schemes) and `br` from the browser.
- **Images.** Crop, turn and scale happen in a canvas, and the result is uploaded as a new file (`POST /_tykerf/asset`, `src/assets.ts`: magic-byte check, raster only, content-hash names, never overwritten). The code changes only `src`, `alt`, `width`/`height`, and drops `srcset`/`sizes`/`<source>`.
- **Where an image came from.** Each derived image is recorded in `.images.json` (`recordEdit`/`imageOrigin`: the original, the crop in the original's turned pixels, quarter turns, the size limit), so the tool reopens the original with the crop on it. Uploads are kept as the original before cropping.
- **Unused files** (`unusedAssets`/`trashUnusedAssets`: nothing in the boxes, head, history, redo list or paste buffer names them; an edited image keeps its original) are offered in the Page tab and move to the page's `.trash/` (`GET /_tykerf/assets/unused`, `POST /_tykerf/assets/clean`). Exports include only the files some page names.

### The Site menu, the page list and the Page tab

- **Page list** (the page name): switch pages. The current page has *Rename* and *Remove*, and *New page…* ends the list.
- **Site menu** (the icon before it): only what acts on the whole site or on TYKERF itself: *Manage the site…*, *Export the site…*, *Export this page…* (in a site), and Kaity's status. Keep it that way.
- **The corner dock** (`.dock`): *Edit with TYKERF* and, in a site, *Manage the site* (`.managebtn`, a link to `/_tykerf/site/`). Both are pills with a symbol and a word, and turn solid teal on hover; *Edit with TYKERF* stays teal while the panel is open.
- **Page tab** of the top block: a status line saying where the page's look comes from (inherited, inherited with own values, own theme, own look); in a site, an *Every page / This page only* switch; the theme values (each marked *site* or *this page* in page mode); the page's head code.
- **Presets** rebuild the whole theme block from TYKERF's current theme (`theme` in `/_tykerf/library`) with the preset's values, which updates older heads and repairs damaged band rules. Changing single values only touches `:root`.

<!-- tykerf:footer -->
---

← [Architecture](architecture.md) · [Developer guide index](README.md) · [The AI and MCP](ai-and-mcp.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
