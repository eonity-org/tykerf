<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **Architecture**
<!-- /tykerf:header -->

# Architecture

TYKERF has one core idea: **a web page is a slicing tree, and every change is a validated move on that tree.** Everything else (the editor, the AI, the MCP server, the importer, export) is built around a small core library in `src/`.

This page is the map. To see the parts working together on one real change, read [Following a change](following-a-change.md) next.

## The slicing tree

A page is cut into **rows** (blocks side by side) and **columns** (blocks stacked), recursively, down to **boxes** (leaves) that hold ordinary HTML. This is how microchip floorplans are described: Otten 1982, Wong & Liu 1986 (normalized Polish expressions), and Stockmeyer 1983 (shape functions). The importer's cutting of existing pages is Nagy & Seth's recursive XY-cut (1984).

The tree is written in **postfix notation**: children first, then the operator that joins them. `H` stacks its children (a column), `V` puts them side by side (a row), and a number after the letter is how many children it joins:

```
$ npm run cli -- outline "nav hero main aside V{3:1} footer H4@page"
page column(H4) (root)
├─ nav leaf (#1)
├─ hero leaf (#2)
├─ o1 row(V2) ratios=3:1 (#3)
│  ├─ main leaf (#3.1)
│  └─ aside leaf (#3.2)
└─ footer leaf (#4)
```

There are two more operators: `W` (a pinwheel of five blocks) and `P` (a periphery, a page frame with north, west, centre, east and south slots). Boxes and operators take attributes:
- boxes: `role`, `type`, `maxw`, `minh`, shapes and `#tags`, in `[…]`;
- operators: ratios, `gap`, `align` and `maxw`, in `{…}`.

**Responsive rules** change the tree below a width: `rule r1 below=800 flip o1` turns the row into a column on narrow screens.

The full grammar and the meaning of every move are in [docs/slicing-notation.md](../../slicing-notation.md). Keep it in sync with the code.

## Data flow

```
 layout.slice ──parse──▶ Layout ──moves (pure, validated)──▶ Layout ──save──▶ layout.slice + .history.jsonl
 (postfix text)          (tree)                                       │
                                                                      ├──render──▶ HTML (flexbox / grid, one
 boxes/<id>.html ───────────────────────────────────────────────────▶│            element per block, box code
 head.html (+ the site's head.html)  ───────────────────────────────▶┘            inside, scoped styles)
```

| Module | Responsibility |
|---|---|
| `model.ts` | The types (`Layout`, `Leaf`, `Op`, `Rule`, `Overlay`), `validate()` (the one source of structural truth), `effective(layout, width)` (the tree at a width, after responsive rules) |
| `notation.ts` | Tokenizer, parser and serializer; `normalize` merges same-operator chains; the `.slice` file format |
| `moves.ts` | Every change to the tree: swap, flip, wrap, unwrap, split, add, remove, move, ratios, tags, rules, rename, graft… Each is pure (`clone → mutate → finish`): `finish` drops rules and overlays whose target vanished and re-validates, so a move returns a valid layout or throws |
| `refs.ts` | References to blocks: a name (`faq`), a path (`page/row2/faq`, `row2/2`) or a position (`#4.2`) |
| `render.ts` | Tree → HTML: rows and columns as flexbox, W/P as CSS grid, overlays with anchor positioning. Each box's `<style>` is wrapped in `@scope ([data-sw="<id>"])`, so box CSS can't leak, and is in no cascade layer, so it wins over the base, the theme, the kit and the page's head (`@layer tykerf, theme, kit, page`, see [Sites](#sites)); tags become `t-<tag>` classes, `k-<name>` tags the class itself |
| `shape.ts` | Shape functions (height as a function of width) and an optimizer for ratios |
| `types.ts` | Box types (`types/<type>.json`): where a block may go and what its code may contain |
| `scope.ts` | The AI's limit to one block: `scopeViolation` compares the page outside the block before and after a change |

## Pages, stores and history

A **page** is a folder:

```
my-page/
  layout.slice          the tree (postfix, one block per token, plus rule/overlay lines)
  boxes/<id>.html       each box's code (HTML, with an optional <style> and <script>)
  head.html             the page's <head> additions (theme, fonts, styles)
  types/*.json          optional box types
  assets/               images and fonts the page uses
  .history.jsonl        every change: label, author (user / ai), time, the previous state
  .redo.jsonl  .tykerf/   redo list; AI conversations, attached images, the paste buffer
```

- **`Store`** (`store.ts`) is where the files live. It is synchronous, with relative paths:
  - `FolderStore` keeps them on disk;
  - `MemoryStore` keeps them in memory, for tests and previews;
  - a future Tydal store will keep a local snapshot.

  Nothing outside `store.ts` reads page files directly.
- **`Workspace`** (`workspace.ts`) is a page:
  - `load`, `save` and `rename` for the tree; `content`, `setContent` and `boxIds` for box code; `head` and `setHead`;
  - `page()` renders it, always the same way for the editor, the CLI, the MCP server and export.

  Every change is logged with its previous state. That gives `undo`, `redo` and `group(label, author, fn)` (several changes as one step, rolled back whole if one fails), and keeps the last 200 steps (`history-trim.ts`, which the site's history uses too).
- **A page of a site** is `new Workspace(where, { site })`, `site` being a `Site` (see [Sites](#sites)): the site's head, kit, icon, language and history come through it, and `ws.pageName` is the page's name in the site.
- **`transaction(fn)`** holds the store's lock across processes: a `.tykerf.lock` folder, reentrant, stale after 5 seconds. The editor and the AI's MCP process change the same folder, so every read-modify-write runs inside it.
- **`addGuard(fn)`** refuses changes made through one `Workspace` object. The editor uses it to lock the block the AI is working on.

## Sites

A **site** is a folder of page folders. Its code is in `src/site/`, one file per part, behind `index.ts` (`src/site.ts` re-exports it, for code that imports the old path):

| File | What it holds |
|---|---|
| `index.ts` | `class Site`: `dir`, `store`, `page(name)` (a `Workspace` of it), `settings()`, `pages()`, `head()`, `kit` (`src/kit.ts` bound to the site), its history (`undo`, `redo`, `steps`, `group`), `transaction(fn)`, and the `SiteLike` methods a page uses; `siteOf`, and `pageWorkspace` (= `site.page(name)`) |
| `settings.ts` | `site.json`: `readSite`, `setHome`, `setTitle`, `setPublish`, `setLang`, `pageTitle`, `derivedTitle` |
| `head.ts` | the shared head: `siteHead`, `setSiteHead`, `siteCode`, `setSiteCode`, `startSiteTheme`, `shareTheme`, `pagesWithOwnTheme` |
| `icon.ts` | the site's icon: `siteIcon`, `madeIcon`, `iconLink`, `setSiteIcon` |
| `pages.ts` | `siteKind`, `sitePages`, new pages (`newSitePage`, `addSitePage`, `newPageLike`, `usePage`), `siteIndex`, `siteMap`, links, `renamePage`, `duplicatePage`, `removePage`, the trash, page moves |
| `blocks.ts` | shared blocks: `shareBlock`, `linkBlock`, `unlinkBlock`, `identicalBoxes`, `shareIdentical`, `siteFiles` |

**A page and its site.** `new Workspace(where, { site, page })` takes the site as a `SiteLike` (`workspace.ts`): an interface of what a page needs of its site, every method required (`head`, `pageNames`, `home`, `lang`, `files`, `asset`, `icon`, `setHead`, `kitHead`, `block`, `setBlock`, `types`, and the history's `undo`, `redo`, `undoAts`, `redoAts`). `Site` implements it, so something new a page shares is a method of `Site` and a line of the interface. The page's own name in the site is the `Workspace`'s (`pageName`): `page`, else its folder's name when the folder is in the site's (none for the site folder itself, as the site's Kaity works on, or for a page in memory such as a preview). A `Site` lives in a folder or in any store: `new Site(store)` (a `MemoryStore`, later a remote store) registers the store under its location (`registerSite`), and every site function given that location as its `dir` reads and writes it through `siteStore(dir)`; a page is a `SubStore` of it (`pageStore`), the store's files under the page's name. `siteKind`, `isSite`, `sitePages` and `siteOf` ask the site's store too (a path inside a registered site, `memory:shop/home`, is a `SubStore` of it), so a site in memory answers as a folder would. Moving a page's folder (`renamePage`, `removePage`, `duplicatePage`) stays a folder's and refuses with why; the trash of a site in memory is empty by definition (`trashedPages`, `emptyTrash`). Tests build sites in memory (`test/site-memory.test.ts`, `test/check.test.ts`). `siteLink(dir)` and the `SiteLink` type remain for one release, as `new Site(dir)` and `SiteLike`.

What the site is and holds:
- `siteKind` tells a page from a site. Besides its pages, a site may hold files and TYKERF's own folders (`assets/`, `out/`) or empty ones; a folder that also holds other folders (a home folder with `Desktop`) is no site, and `siteOf` keeps a page in it on its own, so the page tools never list or make pages there;
- `sitePages` lists the pages;
- `newSitePage`, `newPageLike`, `renamePage` (which rewrites the links in every page) and `removePage` (which moves the page to `.trash/`) manage them.

Links between pages are written from the site root (`/about/`); export makes them relative.

**The shared theme:**
- The site's own `head.html` holds the theme for every page, with its fonts in the site's `assets/` (served at `/assets/`). The first page of a new site writes it.
- A page created in a site gets `{ site }` (`pageWorkspace`, `siteOf`), so `Workspace.page()` renders `siteHead() + head()`.
- A page whose head contains `NO_SITE_HEAD` (copies of websites) keeps its own look.
- `shareTheme` moves an older site from per-page themes to a shared one.
- **The site's icon** (`setSiteIcon`) is a step of the site's history too: the old `favicon.*` out and the new one in, as one group (their bytes in `.tykerf/trash/` while undone).
- **One history for the site** (`site/history.ts`, `SiteHistory`; `Site.undo()`, `redo()`, `steps()`, `group()`): every change to the shared head (`setSiteHead`), the kit (`kitWrite`) and the settings (`writeSite` with a step: `setHome`, `setTitle`, `setLang`, `setPublish`) is a step in `.tykerf/site.jsonl`: `{ kind: 'head' | 'kit' | 'settings', label, author, at, path, prev }`, `prev` being the file's text before (null: it didn't exist). Undo writes `prev` back and keeps the text it replaced in `.tykerf/site-redo.jsonl`; a new step clears it. `group(label, author, fn)` closes the changes `fn` makes with `{ kind: 'group', count }` and undoes them if `fn` throws, as `Workspace.group` does; both trim with `history-trim.ts` (200 steps kept, once 250; the rest to `.tykerf/site-archive.jsonl`). All of it goes through `siteStore(dir)`, the site folder's one `FolderStore` in the process, whose lock is reentrant, so a group can hold it while the changes in it take it again. A rename or a removal rewrites `site.json` without a step (`writeSite(…, null)`: they have no undo), and a rename renames the page in the settings steps' snapshots (`SiteHistory.rewrite`), so undoing an older settings step doesn't bring back the old name. Older sites' two histories (`.tykerf/site-head.jsonl`, `.tykerf/kit.jsonl`) are folded in, in time order, on first use. `undoSiteHead` and `undoKit` remain for one release, as the same `undo()`.
- **The site's language:** `site.json` `lang` (BCP 47, `LANG` in `site.ts`; `readSite` gives `"en"` when it is missing or bad, and `writeSite` doesn't write `"en"`). `setLang` checks it; `Site.lang()` hands it to `Workspace.page()`, which passes it to `toHTML` (`opts.lang`, checked again there; a page in no site is `en`). `siteIndex` and the export's `index.html` and `404.html` use it, and the editor's `/_tykerf/page` sends it with each refresh. A copy that starts a new site sets it from the page's `<html lang>` (`ImportResult.lang`, made a tag by `langTag`), in the CLI's `import` and the start screen's copy. One language per site: a page can't have its own yet.
- **A page's own values** over the site theme live in a `<style data-tykerf-override>` block of the page's head, with a `:root` block of only the values that differ (`readOverrides`, `withOverrides`, validated like theme values; `themeFonts` includes them, so their fonts come along). Coming after the site's head, they win. Because the page has no `data-tykerf-theme` block, it still counts as using the shared theme.
- **Who `setTheme` changes** (`themeTarget`): on a site's only page it changes the site theme (`Site.setHead`, with the site's own undo; this is how Kaity styles a new site's first page); on a page among others it writes that page's own values over it, so one page's AI never restyles the others.
- **`newPageLike`** copies a page's header, footer, head, types and images, with a `text` section between.
- **The four states** a page's look can be in: inherited; inherited with own values; own theme (a `data-tykerf-theme` block in the page head); own look (`NO_SITE_HEAD`). The Page tab shows which one, from `GET /_tykerf/head` (`sharedTheme`, `overrides`, `ownLook`).

**The site kit** (`src/kit.ts`; plan `docs/plans/site-sharing.md`): what every page shares besides the theme, in `<site>/kit/`, one named file each (`kitPath`: `styles/*.css`, `scripts/*.js`, `blocks/*.html`, `types/*.json`, `tags.json`).
- **Writes** go through `kitWrite` (checked by `kitError`: no `@import` or other servers in CSS, types parsed like `types/`, tags not TYKERF's own) under the site store's lock, as a step of the site's history (above; `lastKitChange` is its last kit step).
- **Styles** reach every page as one stylesheet: `Site.kitHead()` gives `<link rel="stylesheet" href="/kit/site.css?v=<hash>" data-tykerf-kit>` (`kitStyles`), the hash being `kitStylesHash` (a short SHA-1 of `kitCSS`, kept per site and made again only when the files' times or sizes change, through `FolderStore.stamp`, or `kitWrite` writes one). The editor serves `/kit/site.css` (cached for a year with `?v=`, `no-cache` without; visitors may load it), `openPage`'s `pageFiles` serves it to screenshots and `evaluate` (`SiteLike.kitCSS()`), and an export writes `kit/site.css` once, linked relatively (`ExportOptions.inlineKit`, CLI `--inline-kit`, the export dialog's checkbox: inlined in each page instead). The editor's page version (`headVersion`) changes with the link's hash.
- **Cascade layers** (`render.ts` `LAYERS`): `@layer tykerf, theme, kit, page;` comes first in `#sw--style`, whose base styles and responsive rules are `@layer tykerf`. `Workspace.page()` puts the heads' styles in their layer at render time (`layerStyles`; the stored heads stay as they are, so the theme code still finds its `:root`): the theme and override blocks in `theme`, the fonts block in none, the site head's other styles in `kit` and a page's own in `page`; `kitCSS` is `@layer kit { … }`. A box's own `<style>` (`scopeStyles`) is in no layer, so it beats them all whatever their specificity; the responsive `!important` rules, in the lowest layer, beat everything, as they should. The renderer's own wrapper selectors are `.sw-slot[data-slot=…]`, so they never reach a shared block's content slots.
- **Styles for a class**: a kit style whose code starts `@scope (.k-<name>)` (`classOf`, `kitClasses`; `kitError` checks the class is the file's name). Any element with `class="k-<name>"` takes it; a tag `k-<name>` renders as that class itself, not `t-k-<name>` (`render.ts`), so the editor's *Class styles* in Size & look and MCP `tag` give a whole box one.
- **Head code**: the site head's own code (`siteCode`) keeps what isn't a style. `setSiteCode` refuses a `<style>` it didn't have; `migrateHeadStyles` (`POST /_tykerf/site/kit/migrate-head`, CLI `site <dir> migrate-head`) moves its `<style>` blocks to `kit/styles/head.css` (a `media` attribute becomes `@media`), as one site group.
- **Fonts**: `kit/fonts.json` (`KitKind` `fonts`, one file like `tags`; `kitFonts`, `FontRegistry` in `library.ts`) registers a site's own families: files in the site's `assets/` (checked by `kitWrite`), weight, style, `display`, licence. Writing it regenerates the site head's fonts block in the same site group; `setSiteHead` passes it to `withFonts`, which declares the bundled families the theme names and every registered one (a page's own fonts block skips the site's, `SiteLike.fonts()`). `fontWarning` warns, without refusing, about a `--font-*` value naming a quoted family neither bundled, registered nor a system one (`set_theme` appends it); `get_theme` lists the registered families; the export report lists those without a licence (`ExportReport.unlicensed`).
- **Behaviours from the library** (`library/behaviours/<name>.js`, `behaviours.json`; `libraryBehaviours`, `behaviourCode`, `behavioursIn` in `library.ts`): a component asks for one with `data-use`. `copyBehaviours` writes the ones a site's kit lacks to `kit/scripts/` (`SiteLike.useBehaviour`, a site step), from `useComponent`, `useLayout`, `newSitePage` (not `createPage`, so the chooser's previews in memory never write a real kit), the editor's box saves and MCP `set_content`/`edit_content`. A page in no site gets none (its components work as plain HTML). `kitLibraryScripts` tells the library's copies (`same`/`changed`): `list_kit` and the manager say so, and *Update from the library* (`POST /_tykerf/site/kit/update-behaviour`) takes the library's again. `kitError` refuses a behaviour without a default export, and one whose code doesn't compile (without imports: `new Function` over it, not run). `KIT_LOADER` dispatches `tykerf:behaviour-error` and keeps `window.tykerfBehaviourErrors`, which the editor shows as a notice.
- **Files** (`src/files.ts`): `readSource` (an http(s) address with a 30 s limit, or with `localFiles` a regular file on this computer, 25 MB), `fileKind` (by the bytes: raster, SVG without scripts, fonts, PDF; CSS and JS only from this computer or when the server says so, CSS checked as the kit's), `placeFile` (the file with the same bytes if there is one, else a free name or one with a hash; 200 MB a folder) and `addFile` (a page step `{ kind: 'file' }`, `Workspace.addAsset`, or a site step, `SiteHistory.addFile`). Undo of an added file, and removal (`removeAsset`, `SiteHistory.removeFile`), keep its bytes in `.tykerf/trash/<hash>` for the step back. The kept bytes go once no step names their hash (`sweepTrash`, when a new change ends the redo list or the history is trimmed).
- **Media** (`site/media.ts`): `fileHash` (cached by `FolderStore.stamp`), `siteFilesByHash`, `copyPageFiles` (a copy of a page takes only the page files its code names, and the site's instead of a file with the same bytes: `newPageLike`, `usePage`; `duplicatePage` drops such files after copying), `siteMedia` (every file of the site and its pages with who uses it: boxes' own code, heads, kit styles, blocks and fonts; held by undo, redo or the buffer; cached by the stamps of every file it reads), `removeMediaFile`, `moveToSite` (every page with those bytes uses the site's), `moveSiteDuplicates`, `pruneMedia`. A component in a box that shows a shared block puts its pictures in the site's files (`SiteLike.putFile`).
- **The site's check** (`src/check-site.ts`, `checkSite`): broken links and pages nothing links to (`pageLinks`), missing files (`missingFiles` per box, `/assets/` in the kit and the site head), titles (from headings computed once), shared blocks with a page's file, own copies equal to a block, fonts without a licence, pictures without alt, files from other servers (`remoteLoads`), a language never set. MCP `check_site` (`sayFindings`), the manager's *Check the site*, and `ExportReport.check` (`findingCounts`).
- **Behaviours:** with any `kit/scripts/*.js`, `kitHead()` adds `<script type="module" src="/kit/loader.js">` (`KIT_LOADER`), which imports `./scripts/<name>.js` for each `[data-use]` element and calls its default export once per element; on `tykerf:render` (the editor re-rendered the page) it first calls the clean-ups of elements that are gone.
- **Shared blocks:** a leaf `use=<name>` (notation, `LeafAttrs.use`). `Workspace.contents()`/`content()` return the block (`Site.block`) for linked boxes; `ownContent()` is the box's own file, kept for unlinking. `setContent` on a linked box writes the block (`Site.setBlock`, a step of the site's history) instead of the page's file, and logs a page history entry `{ kind: 'site', id, block, step }` pointing at that step (its time). The page's `undo()` takes it back through `Site.undo()` while it is the site's next step (`checkSiteOrder` against `Site.undoAts()`, for a group too, in order) and refuses otherwise, naming the site manager; a step the site no longer has (undone there, or trimmed) is passed over. Redo mirrors it (`redoAts`). `peekUndo`/`peekRedo` say `site: true` and the `block`, for the editor's labels and the scope check; emptying it empties only the box. `Workspace.page()` marks links to the page itself with `aria-current` (`markCurrentPage`, `Site.page`; on the site's home page, `Site.home()`, also `/` and `/index.html`). A block keeps no current-page marks of its own: `markCurrentPage` removes them first (`unmarkCurrentPage`: `aria-current` `page`, `true` or bare, in tags only; `step` and the like stay), and `shareBlock` writes the block without them. `shareBlock`, `linkBlock`, `unlinkBlock` (one page undo group), `identicalBoxes` and `shareIdentical` are in `site.ts`; `identicalBoxes` compares copies without current-page marks and with white space collapsed, so a navigation that marks its own link on each page is one group (`normalized: true` when the copies differed that way); `newSitePage` links boxes named like an existing block. A copy of a page (`newPageLike`, `usePage`, so `new_page copy=`, and `duplicatePage`) keeps a linked box linked and takes only its own file (`ownCode`; `setContent(…, { own: true })` writes a linked box's own code instead of the block), never the block's code, which unlinking would otherwise bring back as it was when the page was copied. A block renders under every page's address, so a page's own file (`assets/<file>`) would be looked for in each page's folder: sharing runs the code through `siteFiles`, which copies the page's files it uses (`src`, `href`, `poster`, `srcset`, `url()`, found by `mapPageFiles` in `assets.ts`) to the site's `assets/` and rewrites them to `/assets/<file>`; a site file of the same name with other bytes stays, and the copy gets `hashedName` (`logo-<hash>.png`). `shareBlock` returns the block's name and the files it copied, which the `share_block` reply, the editor's *share* op and the manager's **Share** report. A block written by hand with a page's file is saved with a warning (`kitWarning`, in the `set_kit_file` reply and the manager's kit editor), and `leftovers` reports it on every page that shows it (kind `shared-file`). `Workspace.shownContents()` is the boxes' code as the page shows them (slots filled, current-page marks), for `page()` and the editor's body refresh (`/_tykerf/page`). The image tool's uploads for a box that shows a shared block (`POST /_tykerf/asset` and `/asset/fetch` with `box`) go to the site's `assets/`, answered as `/assets/<file>`.
- **Shared by default:** `layouts.json` gives each layout `shared` (the boxes every page of a site shares: `nav`, `footer`; `PageLayout.shared`, checked by `test/library.test.ts`). `newSitePage(…, { shared })` (default true) links them as the page's starting point, with no undo step (`linkSharedBoxes`): a box named like an existing block shows it; a declared box the site has none of becomes one (`startBlock`: its files to the site, no current-page marks, a site step). The page keeps no copy of their code. `shared: false` (the chooser's checkbox, `new_page`, a copy's empty start page) gives it copies of its own. MCP `use_layout` on a page of a site does the same in its undo group (`shareLayoutBoxes`), as page steps. `rewriteLinks` follows a rename in the shared blocks too (once each, a site step), and `pageLinks` reads every page as visitors see it, so a block's links are listed on each page that shows it.
- **Slots** (`kit.ts`): an element of a block with `data-slot="<name>"` (`SLOT_NAME`) is a slot, its content the fallback; a page fills it with `<template data-slot="<name>">…</template>` in the box's own file. `blockSlots`, `slotValues`, `fillSlots` (the page's view: `Workspace.contents()`/`content()` return the block filled), `unfillSlots`, `withSlotValues`; plain text, matching close tags by depth, no DOM. `Workspace.slots(id)` lists `{ name, fallback, value }`; `setSlots(id, values)` writes the own file (a `content` page step). `setContent` on a linked box splits the code with `sharedEdit`: what is inside the slots becomes this page's values, the rest (slots back to their fallbacks) the block, if it changed at all (compared after `splitStyle`, so a re-joined copy with other blank lines isn't a change); both in one page group. `unlinkBlock` keeps the filled block. The editor's buffer remembers a removed linked box as its block (`use`, and its own file for the slots): pasting it makes a box that shows the block, and pasting into a box links it. `check_page` reports a template naming a slot the block doesn't have (kind `slot`). A content step's redo keeps the box's own file (`ownContent`), never what it shows.
- **Types:** `Workspace.types()` is `Site.types()` (the kit's) under the page's own `types/`.
- **Export** inlines the styles (they're in each page's head) and copies `kit/loader.js` and `kit/scripts/` (`kitFiles` in `export.ts`); `/kit/` addresses are made relative like `/assets/`.

## Layouts, themes and components

`library/` holds:
- `layouts.json`: each layout as a layout plus the component for each box;
- `components/*.html`, listed in `components.json`;
- `theme.html` and `themes.json`: the theme and its presets;
- `fonts/`: Inter, Manrope, DM Sans, Newsreader, Playfair Display and Plus Jakarta Sans, under the SIL Open Font License;
- `assets/`: placeholder images.

- **A small offered set.** `library/` holds only what TYKERF offers. `Other_Layouts/` keeps retired layouts, themes and components, plus the pinwheel (`W`) and periphery (`P`) showcase layouts. TYKERF never loads it; `test/library.test.ts` keeps it valid.
- **Layouts vs components:**
  - a layout (`layouts.json`) is used once, by `createPage`: it writes a layout and copies one component's code into each box, and nothing links the page back to it;
  - a component is one box's code, usable any time (`useComponent`, the MCP `use_component` tool);
  - the theme is the only thing they share at run time.
- **The theme** is CSS variables in a `<style data-tykerf-theme>` block:
  - colours, fonts, the type scale, heading weight and letter spacing, radii, section spacing;
  - a light base;
  - the band tones `.t-tone-alt`, `.t-tone-soft` and `.t-tone-dark`, which set `--section-bg` and paint the tagged block's background (so they work on any box or container), and `.t-dense`, which packs a block tighter.
- **Components** use only theme variables and paint `var(--section-bg)`, so any section takes any band tone.
- **Fonts:** `withFonts` copies the font files a theme names into `assets/` and declares them, so nothing loads from a CDN.
- **The preset a theme came from** is remembered on its block (`<style data-tykerf-theme data-tykerf-preset="studio">`; `themePreset`, `withPresetName`), so the Page tab can show it, say when values changed, and offer *Reset to …*.
- **Defaults and the offered set.** People get the `launch` layout and `DEFAULT_THEME` (`studio`); `createPage`'s own default is `BASE_THEME` (`clean`, the theme's own values, not offered). The set is small and clearly different: 9 layouts (by structure and density: airy `launch`, packed magazine/catalogue, the facts-and-figures page `factual`…) and 6 presets (studio airy, product packed, ivory editorial, gallery soft, dark for developers, warm editorial). `--color-highlight` is a second accent for details and figures on dark cards (by default a light mix of the accent).
- **Whole layouts on an existing page.** `useLayout` replaces a page's blocks with a layout's (head kept, the top block keeps its name, one undo step), for MCP `list_layouts`/`use_layout`. Kaity's page builds start with `use_layout`; the chooser's *Kaity chooses* theme sends no theme, so the brief tells Kaity to pick one.
- **Theme values** go through `withThemeValues`, which changes only `:root`, and `themeValueError`, which checks every value by kind and refuses `url()`, `@import` and anything that could break out of the declaration.

## The other parts

- **The MCP server** (`mcp/`): every move and box operation as a tool, scope-checked. See [The AI and MCP](ai-and-mcp.md).
- **The editor** (`editor/`): an HTTP server and a browser client over the real page. See [The editor](editor.md).
- **The importer** (`importer.ts`): opens a site in Playwright, cuts the rendered page by recursive XY-cut, and copies each box's styles at the site's own breakpoints. It can also list a page's sections and graft one into a box (`placeSection`). At the end, `import-files.ts` downloads the images and fonts the copy loads into its `assets/` and rewrites the addresses, so a copy loads nothing from the original servers.

### The importer in detail

- One import at a time; `importURL` allows http(s) only. The page is rendered at 1440 px, and `@media` blocks are sampled at the site's own breakpoints.
- **Styles** are computed values. A block centred by equal margins keeps `margin:auto` and its px width (a box root too), and `animation-*`/3D properties come along with the `@keyframes` they name (in the head's font block).
- **Operator looks** are kept per tag (`styles`: `s-<id>`, `sp-<id>`), so a part of the copy can take its own CSS. `taken` makes every new name (and its tags) new to the target page (`namesIn(ws)`).
- **Sections.** `sections: true` lists the copy's sections (columns taller than 1300 px are opened up) with a JPEG of each. `placeSection(ws, result, section, box)` replaces a box with one (`M.graft`; the section root takes the box's name) in one undo group: layout, box code, rules, and a head block `<!-- tykerf-import in-<box> … -->…<!-- /tykerf-import in-<box> -->` whose `.t-in-<box>` rule carries the site's base look. `pruneImports` drops blocks whose tag is gone.
- **Files.** `copyFiles` (`import-files.ts`, run at the end of `importPage` unless `fetchFiles: false`) downloads what the copy loads (`src`/`poster`, CSS `url()`, linked font stylesheets inlined first) into `ImportResult.files` (`assets/img-|font-<hash>.<ext>`, checked by bytes: raster images, fonts, SVGs without scripts; 80 MB in all) and rewrites the code; `remote` lists what stays linked. `writeWorkspace` writes all of them, `placeSection` those the section uses.
- **In the editor.** `POST /_tykerf/site/new` with `url` makes a page from a copy; `POST <page>/_tykerf/import {url}` copies a page and keeps it for the `section` op (token-checked).
- **Publish** (`publish.ts`): commits the export, plus a `MANIFEST` of the files TYKERF wrote, to a GitHub branch through the Git Data API, in one commit, sending only files whose blob changed and deleting only files on the previous manifest. Settings live in `site.json`, the token in `TYKERF_GITHUB_TOKEN`.
- **What is unfinished** (`check.ts`): `leftovers` lists sample text, placeholder pictures and links without a target; Kaity's runs and the MCP `check_page` tool use it ([details](ai-and-mcp.md#what-a-request-leaves-unfinished-srccheckts)).
- **Export** (`export.ts`): renders every page without TYKERF, makes the site-root addresses relative, copies the assets, and reports broken links and files still loaded from other servers. It writes a folder or a zip (`zip.ts`, no dependency).
- **Checks** (`metrics.ts`, `screenshot.ts`): sideways scroll, overflow, line length, tap targets and more, plus screenshots of a block or a page. Playwright is loaded lazily, so the MCP server runs without Chromium.

<!-- tykerf:footer -->
---

← [Setup and tests](setup.md) · [Developer guide index](README.md) · [Following a change](following-a-change.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
