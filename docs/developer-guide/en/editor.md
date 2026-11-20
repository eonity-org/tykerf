<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **The editor**
<!-- /tykerf:header -->

# The editor

The editor is a small HTTP server (`src/editor/server.ts`, `src/editor/page.ts`) and two browser clients with no build step (`src/editor/public/`):
- **The shell** (`public/shell.html` and `public/shell/`): the editor people use. One frame on every screen (the top bar and the left rail), the site manager's Overview, the page in a frame with its tasks and Kaity beside it, one composer for everything said to Kaity, the Kaity center, New page and View mode. It is a document of its own: the page in its frame is served exactly as it renders, and nothing is drawn inside it.
- **The full editor** (`public/tykerf.js`): the expert way beside tasks, every block in detail, shown as a page's *Edit* mode (`?mode=full`), its panel docked on the right as the inspector. It is one script added to the page, which draws its panel inside a shadow root, so the site's CSS and the editor's CSS never touch.

**The browser never edits the tree.** It asks the server for named operations, and the server runs them through the same core library the MCP server uses, as author `user`. People and the AI work on one tree and one history.

## The server

`npm start -- <folder> [--port 4400] [--host <addr>] [--layout t --theme th --name p]`

The editor always serves a site (`siteKind`): a folder of pages, or a new or empty folder, which becomes one. Started on a page of a site (`siteOf`), it serves that site; a page folder in no site is refused, with the commands that put it in one. `--layout` on a new folder makes the site's home page, named `--name` or `HOME_PAGE` (`home`); on a site with pages, it adds the page `--name` names (`addSitePage`) unless the site has it already, and refuses without `--name`, so the same command run again only starts the editor; `newSitePage` makes a site's first page its home in `site.json`, whichever way it is made (New page, the CLI, MCP).
- **The site** serves each page at `/<page>/`, with a host per page made on first use (`hostOf`). For a signed-in person, `/<page>/` redirects to the shell, `/_tykerf/edit/<page>/`, unless View mode is on (the `tykerf_view` cookie, `viewing` in `server.ts`): then the page is served as visitors get it with View mode's pill (`shell/view.js`). The page itself is served as it is with `?tykerf=frame` (the shell's frame, the Overview's thumbnails), and with the full editor for `?tykerf=full-frame` (what the shell's Edit mode loads in its frame); `?tykerf=hidden` shows the pill once, without the cookie. `?tykerf=full` and the older `?block=<name>&tab=<tab>` and `?edit` links redirect to `/_tykerf/edit/<page>/?mode=full`, on that block and tab. `/` opens the site manager's Overview (`/_tykerf/edit/_site/`) for the person editing, the home page in `site.json` for visitors and in View mode; the old manager's address `/_tykerf/site/` and `/_tykerf/` go to the Overview too, which shows its first run on a site with no pages (never a redirect to New page). `GET /_tykerf/view?page=<name>` turns View mode on and opens that page (the home page without one); `GET /_tykerf/view/off?next=<editor address>` turns it off and goes there. `/pages/` is `siteIndex` and `/sitemap.xml` `siteMap` (with `TYKERF_PUBLIC_URL`). A removed page's open tabs go to the Overview. `GET /_tykerf/site` also says what Kaity is doing (`kaity: {site, pages: [{page, block}]}`).
- **Pages made elsewhere.** The MCP server or the command line may add pages to the site while the editor runs (in an empty folder, MCP `use_layout` makes the home page, never a page in the folder itself). The rail reads the site again whenever the window comes back into focus, so they show then. Pages renamed or removed from another process (Kaity's site run through MCP `rename_page`/`remove_page`) are in the site's `.tykerf/moves.jsonl` (`renamePage`/`removePage` write it, `pageMoves` reads it): `followMoves()` in `server.ts`, on the folder watcher (`watchSite`, which starts once the site's folder exists) and at the end of each site run, closes the moved page's host, so its open tabs go to the new address (or the Overview), and refreshes the others.

`.env` is loaded from the working folder and the site or page folder. `runnerFromEnv()` then picks the AI runner once for the whole server.

### Global endpoints (`serveGlobal`)

| Endpoint | What it does |
|---|---|
| `GET /_tykerf/library` | Purposes (with their sections' boxes, for New page's *What must it include?*), frames (with their optional `side`), the site's frame, page layouts and theme presets |
| `GET /_tykerf/preview/<layout>/<theme>/[?side=0]` | A layout rendered in a `MemoryStore`, sandboxed (`<theme>` = `site`: with the site's shared theme; `side=0`: without the frame's side menu and side note, as New page makes it): New page's live preview and *Full size* |
| `GET /_tykerf/site` | `pages`, `changed` (each page's last change: when, by whom, what), `sharedTheme`, `home`, `titles`, `kaity` (what she is doing now) |
| `POST /_tykerf/site/new` | A new page: `{name, layout, side, shared, theme}` (`theme` another than the site's: this page's own values over it, `setTheme`), `{name, url}` (a copy), `{name, like}` (like another page) or `{name, prompt, files, theme}` (Kaity builds it from the brief; `files` are pictures, PDFs and a design ZIP, `attachments.ts`; the older `images` and `zip` still work: answers with `select`, the block to open on). A copy and an AI build answer at once and run as the page's **job** (below) |
| `POST /_tykerf/site/rename`, `/site/remove`; `GET /site/links` | Rename a page (links follow) or move it to `.trash/`; refused while any page's AI runs. The links between pages (the manager's *Links between pages*) |
| `GET /favicon.<ext>`; `GET`/`POST /_tykerf/site/icon` | The site's icon (`siteIcon` in `site.ts`: `favicon.svg/png/ico` at the site root, else `madeIcon`), served to visitors too; `{type, data}` (base64) sets it, `{}` goes back to the made one. Pages link to it through `Site.icon()`, which `Workspace.page()` puts first in the head. TYKERF's mark is `/_tykerf/favicon.svg`: its own screens use it, and `tykerf.js` swaps a page's icon for it while editing |
| `POST /_tykerf/site/duplicate` | `{name, to?}`: a copy of the page (`duplicatePage`: without its history, chats or `out/`), named `<name>-copy` when `to` is missing; refused while Kaity works on it |
| `GET/POST /_tykerf/site/head`, `POST /site/head/undo`, `/site/theme/share` | The site's shared theme, its undo, and turning one page's theme into the site's |
| `POST /_tykerf/site/home {name}`, `/site/title {name, title}`, `/site/lang {lang}` | The home page, a page's own title and the site's language, in `site.json` (a language chosen is kept, English too: `langSet`) |
| `GET /_tykerf/site/tasks`; `POST /site/tasks/give {pages?}`, `/site/tasks/stop` | Every open task of the site by page, with Kaity's run on each and the queue; Give Kaity everything (or these pages), page after page; stop it |
| `GET/POST /_tykerf/site/code` | *Styles & scripts*: the site head without its theme and fonts blocks (`siteCode`/`setSiteCode`) |
| `GET /_tykerf/site/trash`, `POST /site/trash/empty` | The removed pages, and deleting them for good |
| `GET /_tykerf/site/chat`, `/site/events`; `POST /site/ask {prompt, files}`, `/site/ask/cancel`, `/site/chat/reset` | Kaity for the whole site ([ai-and-mcp.md](ai-and-mcp.md#kaity-for-the-whole-site)); the event stream also carries each page's Kaity starting, answering and ending (`createPageHost`'s `onAi`, with `page`) |
| `GET /_tykerf/site/thread` | One thread of everything Kaity was asked and did, on the whole site and every page, oldest first (the runs of `kaity-log.ts` with `kind`: `ask`, `task`, `fix`, `continue`; `scope`; `files`; `undoable`) |
| `POST /_tykerf/site/kaity/undo {run}` | Undo one run from the thread: its tag taken back on its page, or on every page for a whole-site run (`revertTagged`), logged as undone (`logUndo`) |
| `GET /_tykerf/site/image/<file>` | A file attached to a request about the whole site (sandboxed) |
| `GET /_tykerf/site/kaity` | Every run on any page or the whole site, from the site's log (`kaity-log.ts`), the ones going on first with their current step (`AI.progress()`) |
| `GET /pages/`, `/sitemap.xml` | The list of pages (`siteIndex`: title, address, the home page marked; a footer with the TYKERF mark and the way to sign in or to the manager) and the sitemap (with `TYKERF_PUBLIC_URL`) |
| `GET/POST /_tykerf/login`, `POST /_tykerf/logout` | Signing in when `TYKERF_ADMIN_PASSWORD` is set (`auth.ts`; sessions as token hashes in the site's `.tykerf/sessions.json`, so restarts keep them). Signed in already, `GET /_tykerf/login?next=` goes straight on; `/_tykerf` and `/_tykerf/` redirect to the manager. A visitor's page ends with `EDIT_BUTTON` (`createPageHost`'s `visitorEnd`): *Edit with TYKERF* to the sign-in page, only where the browser's `tykerf.admin` is set (the login page sets it, the manager's **Sign out** clears it) |
| `GET /_tykerf/version` | Whether the server's code changed since it started (the restart notice) |
| `GET /_tykerf/site/publish`, `POST /site/publish/settings {settings}`, `POST /site/publish` | Publish (`src/publish.ts`): where to (`site.json` `publish`), whether `TYKERF_GITHUB_TOKEN` is set (never the token), the last publish (`.tykerf/published.json`); the publish itself, refused while Kaity works (409) |
| `GET /assets/*` | The site's own files (the shared theme's fonts) |
| `GET /_tykerf/export/report`, `/_tykerf/export.zip[?links=files][&page=<name>]` | What an export holds, and the export itself: the page or the whole site, or with `page` one page of the site (404 for a name that isn't a page) |
| `GET /_tykerf/ai/status`, `POST /_tykerf/ai/test` | Which runner and model answer, whether it's ready (never a key), and one tiny real request |

### The site kit's addresses

| Endpoint | What it does |
|---|---|
| `GET /kit/loader.js`, `/kit/scripts/<name>.js` | The behaviours' loader (`KIT_LOADER`) and the site's behaviours, for every page of the site (visitors too); also for a lone page of a site |
| `GET /_tykerf/site/kit` | The manager's view: files by kind, the last change, `identicalBoxes`, and the pages that show each block |
| `GET /_tykerf/site/kit/file?kind=&name=`; `POST /_tykerf/site/kit/file` | One kit file; create, replace or remove it (`text: null`) through `kitWrite` |
| `GET /_tykerf/site/media`; `POST /_tykerf/site/media/{upload,remove,move,prune,dedupe}` | Media (`site/media.ts`): every file with who uses it; add, remove (to `.tykerf/trash/`, a step), move a page's file to the site, prune the unused, use the site's files where pages have copies |
| `GET /_tykerf/site/check` | The site's check (`check-site.ts`), with the kinds' headings and the last design check's counts (`design`: kept by `POST /_tykerf/site/design`, for the Overview and the top bar's Checks) |
| `POST /_tykerf/site/kit/share` | Share a box that is the same on several pages (`shareIdentical`) |
| `GET /_tykerf/site/history`; `POST /_tykerf/site/undo`, `/_tykerf/site/redo` | The site's one history (`SiteHistory`): its last 30 steps and what Undo and Redo would do; undo or redo its last step (409 while Kaity works on the whole site). The older `/_tykerf/site/head/undo` and `/_tykerf/site/kit/undo` do the same undo |

Every kit change refreshes every open page (a watcher on the site's `kit/` folder catches changes from Kaity's MCP process and from shared blocks edited on a page); a change to the kit's styles or behaviours changes `state().head`, so open pages reload. After it re-renders the page, the client dispatches `tykerf:render` for the behaviours.

### One page's endpoints (`createPageHost` in `page.ts`)

Paths are relative to the page: `/<page>/_tykerf/…`.

| Endpoint | What it does |
|---|---|
| `GET /` | The page as it renders, plus `<script src="_tykerf/tykerf.js">` |
| `GET /assets/*` | The page's images and files (sandboxed CSP, nosniff) |
| `GET /_tykerf/state` | The panel's tree, the layout, the AI's run, the runner, undo and redo labels, the head version, the site's pages |
| `GET /_tykerf/events` | Server-sent events: `changed` (refresh), `ai` (a run's steps and answer; a step carries `where`, the block or task it is about, from `stepAt`, which the page follows: `followKaity` scrolls to a block out of sight unless the wheel, a touch or a scrolling key moved the page in the last 6 s, and `drawKaity` frames that block on a whole-page run), `moved` (the page was renamed or removed), `tasks` (the tasks changed), `taskrun` (Kaity working through the tasks: the run's state) |
| `POST /_tykerf/op` | A named operation (`OPS`): `insert`, `add`, `flip`, `ungroup`, `reorder`, `rename`, `ratios`, `height`, `width`, `look` (band tone and density: the `tone-*` and `dense` tags, one step), `tag` (one of the site kit's tags, on or off), `share`, `link`, `unlink` (shared blocks: `shareBlock`, `linkBlock`, `unlinkBlock` in `site.ts`), `delete`, `remove`, `paste`, `drop`, `component`, `section` |
| `GET/POST /_tykerf/box`, `GET /_tykerf/page` | One box's code (content and style apart), and the rendered parts |
| `GET/POST /_tykerf/head` | The page's head, whether its theme is the site's (`sharedTheme`), its own values over it (`overrides`) and whether it keeps its own look (`ownLook`) |
| `POST /_tykerf/head/override` | This page's own theme values over the site theme (`{values}`: only those that differ; `{}` follows the site again); checked like theme values, one undo step |
| `POST /_tykerf/asset`, `/asset/fetch`; `GET /assets`, `/asset/origin` | Images from the image tool or copied from another server, the page's images, and where a cropped image came from |
| `POST /_tykerf/undo`, `/redo` | One step; refused (409) while the AI runs |
| `POST /_tykerf/import` | Copy a page and list its sections, for *Import a section* (token-checked `section` op) |
| `POST /_tykerf/ask {id \| scope: 'page', prompt, files}`, `/ask/cancel`, `/chat/reset`; `GET /chat`, `/image/<file>` | Kaity on one box, or on the whole page (`scope: 'page'`: the page's top block, whose run may change any of its blocks and nothing else), with the files attached (`attachments.ts`); the conversation of a block; a file attached to it |
| `GET /_tykerf/tasks`; `POST /_tykerf/tasks/add`, `/edit`, `/close`, `/reopen`, `/remove`, `/clear`, `/ask` | Tasks left on the page (`src/tasks.ts`): every task, under its block's current name, plus the open ones as text (`sayTask`) for *Copy all*; add one (`block`, `path`, `label`, `width`, `text`, `question`), change one (`n`, `text`, `question`), close (`n`, `reply`), reopen, remove, remove the done ones (each an undo step), and have Kaity work through a block's open tasks (`AI.askTasks`). A change broadcasts the SSE `tasks` event, as does a change to `.tykerf/tasks.json` from outside (the AI's MCP process closing one) |
| `GET /_tykerf/kit` | The site kit as the panel needs it: the shared blocks, the pages that show each (`users`), and the site's tags |
| `GET /_tykerf/taskrun`; `POST /_tykerf/taskrun/start`, `/stop`, `/skip`, `/answer`, `/leave`, `/undo`, `/undo-all`, `/keep` | Kaity working through the tasks one by one (`src/editor/task-run.ts`, see [the AI and MCP](ai-and-mcp.md#kaity-task-by-task-srceditortask-runts)); SSE `taskrun` carries the run's state |
| `GET /_tykerf/handbook`, `/handbook.md` | The handbook (`src/handbook.ts`): the page's theme and blocks with their tasks, as a page for people (`<base href="../">`, so the page's fonts and the link back resolve) and as Markdown |
| `GET /_tykerf/job`; `POST /_tykerf/job/stop`, `/job/seen` | The page's background job (a copy, or the AI building the page): its steps and how it ended; stop it; forget it once seen. Changes stream as the SSE `job` event |

Every operation runs inside `ws.transaction()`, then broadcasts `changed`. Changes from outside (the AI's MCP process, a text editor) reach open pages through the store's watcher.

### Code updates

The client files in `public/` are read from disk on every request, but the server process keeps the TypeScript it started with. `codeStamp()` (server.ts) fingerprints `src/**/*.ts` (count, sizes, latest change) at startup; `GET /_tykerf/version` says whether it differs now. `tykerf.js` and `start.html` ask on load and when the tab comes back, and show a restart notice when it does, or when the address is missing (a server older than this check).

The other way round, a page keeps the script it loaded: after an update and a restart, an open tab still runs the old `tykerf.js` (its event stream simply reconnects). `/_tykerf/version` also returns `page`, `pageStamp()` of `public/` (`TYKERF_PAGE_DIR` in tests); the page remembers the first one it gets and asks again when its event stream reconnects (the manager: when `/_tykerf/site` answers again after failing) and when the tab comes back. A different one shows *Reload this page…* with a **Reload** button; it never reloads by itself, so a draft isn't lost.

### Security

- The server listens on `127.0.0.1` by default.
- `foreign()` refuses:
  - other `Host` headers (against DNS rebinding);
  - changes from other origins, or without a JSON body (against cross-site requests).
- Every state-changing endpoint must stay behind `foreign()`.
- Page files are served with `Content-Security-Policy: sandbox`, and uploads are checked by their bytes.
- Box scripts run in the editor's own page and origin, so they can call the API too. That is a documented, accepted risk, explained in [SECURITY.md](../../../SECURITY.md).

## The shell

The editor people use is one **shell**: `public/shell.html`, at `/_tykerf/edit/<page>/` for a page (a page the site doesn't have is a 404) and at `/_tykerf/edit/_site/<screen>` for the site (`server.ts`; `/_tykerf/edit/_site/` is the Overview). `public/shell/boot.js` picks the mode: `shell.js` (a page, with `frame.js`) or `site.js` (the site). Plain ES modules like the rest of the client:

| Module | What it holds |
|---|---|
| `chrome.js` | **The one frame** on every screen: `renderTop` (the top bar) and `createRail` (the left rail), `siteInfo`, `screenStates`, `pageModes` (Tasks · Edit · View and the widths) |
| `composer.js` | **The one composer** for everything said to Kaity (`createComposer`: *Kaity may change* chips, Attach, drop and paste, Enter to send), and `readFiles` / `fileChip` for the task box and New page |
| `kaity.js` | **One Kaity**: the thread (`threadHTML`, `/_tykerf/site/thread`), `createThreadView` (filters, the list, the composer), the Kaity center drawer (`createKaityCenter`), its page (`kaityScreen`), `askKaity` (to the whole site, a page or a box), `onKaityNews` (the site's event stream) |
| `overview.js` | The site manager's **Overview** and the first run |
| `newpage.js` | **New page**: Describe it to Kaity, From a kind of page (the live preview), Copy a web page, Like a page of this site |
| `screens.js` | The site's other screens: About this site, Shared blocks, Check the site, Media, Links between pages, Head code, Site history, Publish, and *Every open task* |
| `site.js` | Site mode: the frame around the site's screens (`SCREENS`), `go(screen)` without reloading |
| `shell.js`, `frame.js`, `fix.js` | A page: the page in its frame, what tykerf draws over it, tasks, the tray, the status line, the side panel, fixing by hand |
| `view.js` | View mode's pill, in the page's own document (a shadow root) |
| `common.js` | What they share (`t`, `request`, the toast, `plainLabel`, the marks, `DOCS`, the guides' links) |

**One frame on every screen** (`chrome.js`). Modes change the centre, never the frame:
- **The top bar** (`renderTop`): the mark and where you are (*Your site / <screen or page>*), the page's modes in the centre on a page (`pageModes`), then **Kaity ▾** with how many runs the thread holds (it opens the Kaity center; her balls pulse while she works), **Checks** (the site's check's count plus the last design check's must-fix ones, `checkCount`; it opens Check the site), one **Undo** (the site's on site screens, the page's on a page; its name says the step) and one **Publish**. No other Undo or Publish is drawn anywhere.
- **The rail** (`createRail`): *Pages* with **+ New page** (on a page, the open page's boxes in page order under it, `boxesOf`, indented by depth; picking one is `onBlock`); *Site* (Overview, About this site, Shared blocks, Media, Links between pages, Check the site, Head code, icon & language, Site history, each with its state, `screenStates`); *Assistant* (Kaity center); Docs and Sign out. It is docked, folds to a strip with its own control (‹ ›, remembered as `tykerf.railFolded`), and under 900 px stacks above the content, folded to one line until opened.

**The site** (`site.js`): the rail and a screen beside it; `go(screen)` changes screens without a reload (`pushState`), the top bar's Checks and Publish too. The site's event stream (`onKaityNews`) refreshes the rail and the Overview when Kaity starts or ends anywhere.
- **The Overview** (`overview.js`, the default screen): the counts, **View site** and **+ New page**; a card per page (a thumbnail: the page at `?tykerf=frame` in a scaled `iframe sandbox="allow-same-origin"`, `loading=lazy`, laid out at 1440 px and scaled to the card, `fitThumbs`; name, address, Home, title, who changed it last and when, open tasks; *Open*, *View*, *Name and title*, *Duplicate*, and ⋯ for *Make it home* and *Remove…*, which says which pages' links to it will point nowhere), and a New page card; **Before you publish** (the design check, About this site, links between pages, the language, the other checks, each with what to do); **Kaity lately** (her last three runs, newest first, and a compact composer for the whole site); **Learn tykerf** (`DOC_LINKS`, the guides on GitHub, `DOCS`). A site with no pages shows the **first run** instead: what tykerf is in three steps, the Documentation card (`DOC_CARD`) and *Create your first page* with its three starts (`/_tykerf/edit/_site/new?start=describe|kind|copy`).
- **New page** (`newpage.js`) is in the same frame; the rail shows the page as *being set up* (`setPending`), **Cancel** goes back where the person came from (`?from=`). Its tabs: *Describe it to Kaity* (five questions, each optional: the kind of page, who it is for, the sections, suggested from the purpose's own boxes by `/_tykerf/library` and named by `SECTION_WORDS`, with *Add another*; the tone; anything else, with **Attach files** for pictures, PDFs or a design ZIP; *What Kaity will get* shows the brief `assemble` makes, editable, and it is exactly the `prompt` sent), *From a kind of page* (what the page is, what holds it as small drawings, the side menu and the shared navigation, theme cards with *Site theme* first when the site has one and a warning for another, beside a live preview, `/_tykerf/preview/<layout>/<theme>/?side=0|1`, at Desktop, Tablet or Phone width, with **Full size** over the screen and *← Back to choices*, never a new tab; **Create … and open it**, or **Then ask Kaity to fill it**, which opens the page with `?ask=page`: the composer on the whole page), *Copy a web page* and *Like a page of this site*. What is chosen survives going to another screen and back (`draft`).
- **The Kaity center** (`kaity.js`): a drawer from the top bar's Kaity button (or the rail) on every screen, and the same at `/_tykerf/edit/_site/kaity` (*Open as page*). Its filters: *Everything*, *Whole site*, each page, *Tasks* (every open task of the site, page by page, with **Give Kaity everything**: the old *Every open task* screen, still at `/_tykerf/edit/_site/tasks`). The thread runs from the oldest to the newest and opens scrolled to the newest, next to the composer, with a heading for each day. A run asked for in words shows the person's message (folded past 600 characters: *Pasted text · N characters · Show all*; its files as chips) and her answer (her steps, Undo); a task run, finishing what a run left, or going on after a stop, shows as one compact line. **Undo** takes a run back (`/_tykerf/site/kaity/undo`); a run going on has **Stop Kaity** and its latest step.

**A page** (`shell.js`): the rail with the page's blocks, the page column (the status line, the page in its frame, the composer) and the side panel. *Tasks · Edit · View* in the top bar's centre, then the widths.
- **The page is in a frame**, at its own address with `?tykerf=frame`: `page.ts` serves it as it is, without `tykerf.js`. At *Desktop* it lays out at the room its column has; at 768 or 375 px it lays out at that width, in the middle, and is shown smaller when the column is narrower (`layoutStage`: `.viewport` scaled, `S.zoom`; what tykerf draws over it scales with it, labels and the task box drawn back at their own size). `frame.js` is the only code that touches the page's document (same origin): it turns clicks into picks (links, buttons and forms don't react), finds the block and the element path (`inline.js`), measures elements (`rect`: a box with no box of its own is measured by its children), and swaps new content in place after a change (`/_tykerf/page`). A change to the head reloads the frame.
- **Nothing is drawn inside the page.** Outlines, pins, the flash of a block shown (`flash`, found again by its block if the content was swapped) and the task box are in the shell's own document, in `.overlay` over the frame, placed from the elements' boxes and redrawn on scroll, resize and content changes.
- **The status line** (`renderStatus`, above the page): a hint, or what is going on, with its actions: Kaity working through tasks (*task i of n* with a chip for the task, **Stop Kaity**, **Undo all she did**, *Show / Hide the steps*), the review (`runSum`, **Keep the n changes**, **Undo all she did**), a page being made (the job: its latest step, **Stop Kaity** / *Stop the copy*, **Got it**, **Continue**), Kaity on something asked from the composer (`S.asking`, from the page's `ai` events: **Stop Kaity**), fixing by hand (**Done, back to tasks**), trying the page (**Done trying**); and the tasks' count, which opens the tray.
- **The side panel** (`renderSide`): *Tasks on <page>* (the open tasks with their numbers, as the pins have them; a task shows on the page and in the tray; **Give them to Kaity** starts the task run, **Do it myself** opens the fix panel on the first one) and *Kaity on this page* (the thread filtered to the page, newest at the bottom, with Undo; *Whole thread* opens the Kaity center). While fixing by hand the fix panel (`fix.js`, mounted with `mount`) takes its place.
- **The composer under the page**: *Kaity may change* **This box: <block>** (the block picked in the rail or on the page, `S.sel`), **This page** (the default) or **Whole site**; Attach; it sends through `askKaity`. This page asks on the page's top block: the run's MCP scope is that block, so any block of the page may change and nothing else (shared blocks keep their own rules), and her instructions say so (`blockSystem`'s `whole`).
- **Picking a block** in the rail shows and flashes it on the page and offers it as the composer's *This box*; a click on the page does the same, and opens the task box. In Edit mode the rail's pick selects it in the full editor (`window.tykerfSelect`), and the full editor's selection shows in the rail (`window.top.tykerfSelected`).
- **The task box** (`renderBox`) is anchored to the element clicked: one line with *New task* (a button: it turns into *Question* by itself when the text ends with `?`, until the person clicks it to choose; a task gets its number when it is added), the block (its tooltip: Kaity changes only it), the element in words, a width chip only away from Desktop, and ×; the field; **Attach** with the files as chips (pictures scaled down as Kaity's are, and PDFs: `readFiles`; a paste or a drop on the box too); *More… or right-click*, **Kaity, do it now** and **Add task**. `/tasks/add` keeps the files as her attachments are (`AI.keepImage`, `.tykerf/images/`), the task stores their names (`Task.images`), and `TaskRun` sends them with the task.
- **The tray** (`renderTray`) lists the page's open tasks and questions as cards, and, while Kaity works and after, one card per task (`runCard`) with everything the review offers: *See it on a phone*, *Try the button*, *Before and after*, *Undo this one*, *Ask for more*, *See her conversation on <block>*, what she left unfinished (**Fix them**, **Leave them as they are**), her question with an answer field, her answer to a question with what it suggests. On the page her element is outlined with *n · Kaity is here*, and the page follows her unless the person scrolled in the last 6 s (`followKaity`).
- **Edit mode** (`FULL`, `?mode=full`): the frame loads `?tykerf=full-frame`, `frame.js` stays passive (no picks, no pins, no overlay), there is no side panel or composer, and the status line points to the tasks. The full editor docks its panel on the right of the frame and gives the page its width less the panel's (see *The full editor*).
- **View mode** replaces *Hide tykerf*: the top bar's *View* (and **Alt+Shift+T**, the right-click menu's *View the site as visitors see it*, the Overview's *View site* and each card's *View*) goes to `/_tykerf/view?page=<name>`. The pill (`view.js`) says *Viewing*, switches pages (with *Back to the site manager*) and has **Edit this page** (`/_tykerf/view/off`); following the page's own links keeps it, since every page of the site reads the cookie.
- **The second button** on the page (`openMenu`): *Leave a task here…*, *Ask a question here…*, *Edit this text* (also a double click), *Fix it by hand*, *Add a box below… / beside…*, *Delete this box…* (confirmed in the menu), *Open … in the full editor*, *View the site as visitors see it*; arrow keys and Escape work in it.
- **Fixing by hand** (`createFixPanel` in `fix.js`), from *Fix it by hand* or *Do it myself*: in the side panel, beside the page, on the element clicked; a click on the page picks the next thing to fix. A link or button shows its words and where it leads, a heading or paragraph its words, a picture its description and *Choose another picture…*; a save writes into the box only when its code still has the element as the page shows it. *More, if the fix is bigger* opens the full editor on the box and the tab. *Leave it as a task for Kaity* opens the task box on the element.
- **Give Kaity everything** (`POST /_tykerf/site/tasks/give`) queues the pages with open tasks and starts each page's task run in turn (`nextQueuedPage` in `server.ts`).
- **The update notice** (`watchVersion` in `common.js`): *TYKERF was updated… Restart it* when the server's code changed, or *reload this page* with **Reload** when the browser part changed under an open tab.
- Tests: `test/shell*.test.ts` (a page, the site, New page, Kaity, fixing by hand), `test/site-editor.test.ts`, `test/attachments.test.ts`.

## The full editor

The expert way, beside tasks, for long manual work: a page's *Edit* mode (on the box being fixed, when there is one), from the top bar, the right-click menu and the quick fix's *More*. In the shell's frame (`EMBEDDED`) its panel is **the inspector, docked** (`dock()`, `DOCKED`, the `docked` class on its host): fixed on the right of the frame, 400 px (`DOCK_W`), never moved or compacted, and the page's `html` gets that width as its right margin (`#tykerf-dock`), so the page lays out beside it and is never covered. Docked, its header holds only the path of the selection and Dim/Blur: the box tree is the shell's rail and the one Undo the top bar's (`:host(.docked)` rules at the end of `tykerf.css`); it moves the top window for navigation (`go`). Opened at the top level, `?tykerf=full-frame` is the full editor on its own, with its own header (the brand, the path, Dim/Blur, Undo/Redo, Compact and ×; its tests use it). `public/` holds plain ES modules, served as they are:

| File | What it holds |
|---|---|
| `tykerf.js` | The panel: state (`S`), the tree, the tabs (Blocks, Text, Code, Size & look, Page), editing text and images in place, tasks on the page (pins, the task form), popovers, refreshes |
| `inline.js` | Pure helpers for editing in place (mapping an element to its box code, cleaning what the browser typed); tested in `test/inline.test.ts` |
| `shell.html`, `shell/` | The shell (above) |
| `fonts/`, `brand/`, `i18n/` | IBM Plex (bundled, SIL OFL), the logo, translations |

How the client works:
- **API base.** `tykerf.js` derives it from `location.pathname`, so the same client works under any `/<page>/`. A page that moved is followed in the shell's Full editor mode (`full()`); a tidied address keeps `?tykerf=full-frame` (`FULL_HERE`), so a reload stays.
- **Per-block state.** Each block keeps its own tab and unsaved drafts (`per(id)`).
- **A page being made.** On load and on the `job` event, `renderJob` shows a modal over the page with the job's steps: the importer's stages (`onStep`, English sentences translated with `t()`), or the AI's tool calls. It has an × (stop) and, at the end, a short guide with *Open the editor* / *See the page*. The modal blocks the page, so nothing disturbs the AI.
- **How the job modal looks.** While it shows, the panel and the Edit button are hidden; the TYKERF logo and the × head it, with Kaity's line under them, smaller. Steps come short from `step()` in `ai.ts` and wrap, never clipped (Chrome garbles clipped lines in that scrolled list). A running job is a small card in the bottom right corner over a light veil (`.jobmodal.running`), so the page coming together is what people watch; at the end it returns to the middle.
- **A page coming into focus.** While Kaity builds a page, `state().build` lists the boxes with sample content left (`leftovers`), apart in `strong` (not reached yet) and `soft` (changed since the last whole-page step: `Workspace.boxesWorkedOn`). `applyFocus()` writes them as blur rules in a `<style id="tykerf-focus">` in the page's head; `refocus()` applies new rules a frame after the body is replaced, so a finished box sharpens with its transition. *See the page clearly* turns it off; the end of the job clears it.
- **Refreshes.** A `changed` event reloads the state and the page's body. A change of head reloads the whole page, because a head can't be swapped in place. Refreshes wait while text is being edited or the image tool is open.
- **Text.** Every string a person sees goes through `t('English text', vars)`, with whole sentences as keys (see [Extending TYKERF](extending.md#a-translation)).
- **Fonts.** The panel's fonts are declared in `document.head` under TYKERF-only names (`@font-face` doesn't work inside a shadow root) and served by TYKERF. Nothing loads from a CDN.

### Tasks and Kaity in the full editor

Kaity is asked with tasks here too (it has no Kaity tab). Open tasks show as pins; the context menu's *Add a task for Kaity here…* (`openTaskForm`) and the empty Text tab's *Leave a task for Kaity* write an ordinary task, and *Add and give it to Kaity* / a pin's *Give it to Kaity* start the task run with it (`/taskrun/start`) and take the top window to Tasks, where she is followed. While she works, her block carries her balls in the tree and a frame on the page (`drawKaity`). The block conversations' endpoints (`/_tykerf/ask`, `/_tykerf/chat/reset`, `/_tykerf/tasks/ask`) stay on the server, unused by the interface.

### Editing in place

`tykerf.js` does the editing, with the pure helpers in `public/inline.js`.
- **Mapping.** An edit maps a page element to the box code by its element path (skipping `style`/`script`/`template`), and only when the code there has the same markup as the element had when the edit started. Otherwise it falls back to the Text tab.
- **Shared blocks.** A box that shows one is mapped against its code as the page shows it (the block, its slots filled), and saved through `setContent`, which splits it (`Workspace.sharedEdit`): what is inside the block's `data-slot` elements is this page's (its own file's `<template data-slot>`), the rest the block's, every page's. So editing a slotted heading in place fills the slot, and the block stays as it is. The Text tab of such a box lists its slots instead (`renderSlots`, `POST /_tykerf/slots` → `Workspace.setSlots`), each with the block's text as its placeholder.
- **Add files…** (the Page tab's *Files*, `POST /_tykerf/files`; the manager's head code card, `POST /_tykerf/site/files`, and Media, `POST /_tykerf/site/media/upload`): one file per request, base64 in JSON (the body limit is 36 MB), into `files.ts` `addFile`, which answers the address to write.
- **Size & look** also lists the site kit's styles for a class (*Class styles*, `S.kit.classes` from `GET /_tykerf/kit`): one toggles the tag `k-<name>` on the block (the `tag` op accepts it when the class style exists), which renders as the class `k-<name>`. The Code tab lists them, `class="k-<name>"`, to copy.
- **Text** edits are limited to inline-only elements (text, `br`, `strong/b/em/i/a`). `cleanInline` keeps the elements that existed before the edit as they were, and allows only `strong`, `em`, `a[href]` (safe schemes) and `br` from the browser.
- **Images.** Crop, turn and scale happen in a canvas, and the result is uploaded as a new file (`POST /_tykerf/asset`, `src/assets.ts`: magic-byte check, raster only, content-hash names, never overwritten). The code changes only `src`, `alt`, `width`/`height`, and drops `srcset`/`sizes`/`<source>`.
- **Where an image came from.** Each derived image is recorded in `.images.json` (`recordEdit`/`imageOrigin`: the original, the crop in the original's turned pixels, quarter turns, the size limit), so the tool reopens the original with the crop on it. Uploads are kept as the original before cropping.
- **Unused files** (`unusedAssets`/`trashUnusedAssets`: nothing in the boxes, head, history, redo list or paste buffer names them; an edited image keeps its original) are offered in the Page tab and move to the page's `.trash/` (`GET /_tykerf/assets/unused`, `POST /_tykerf/assets/clean`). Exports include only the files some page names.

### The Page tab and the corner

- **The corner dock** (`.dock`): *Edit with TYKERF*, a pill that turns solid teal on hover and stays teal while the panel is open; in the shell it shows only while a job keeps the panel closed.
- **Page tab** of the top block: a status line saying where the page's look comes from (inherited, inherited with own values, own theme, own look); in a site, an *Every page / This page only* switch; the theme values (each marked *site* or *this page* in page mode); the page's head code.
- **Presets** rebuild the whole theme block from TYKERF's current theme (`theme` in `/_tykerf/library`) with the preset's values, which updates older heads and repairs damaged band rules. Changing single values only touches `:root`.

<!-- tykerf:footer -->
---

← [Following a change](following-a-change.md) · [Developer guide index](README.md) · [The AI and MCP](ai-and-mcp.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
