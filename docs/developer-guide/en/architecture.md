# Architecture

TYKERF has one core idea: **a web page is a slicing tree, and every change is a validated move on that tree.** Everything else (the editor, the AI, the MCP server, the importer, export) is built around a small core library in `src/`.

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
| `render.ts` | Tree → HTML: rows and columns as flexbox, W/P as CSS grid, overlays with anchor positioning. Each box's `<style>` is wrapped in `@scope ([data-sw="<id>"])`, so box CSS can't leak; tags become `t-<tag>` classes |
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

  Every change is logged with its previous state. That gives `undo`, `redo` and `group(label, author, fn)` (several changes as one step, rolled back whole if one fails), and keeps the last 200 steps.
- **`transaction(fn)`** holds the store's lock across processes: a `.tykerf.lock` folder, reentrant, stale after 5 seconds. The editor and the AI's MCP process change the same folder, so every read-modify-write runs inside it.
- **`addGuard(fn)`** refuses changes made through one `Workspace` object. The editor uses it to lock the block the AI is working on.

## Sites

A **site** is a folder of page folders (`site.ts`):
- `siteKind` tells a page from a site;
- `sitePages` lists the pages;
- `newSitePage`, `newPageLike`, `renamePage` (which rewrites the links in every page) and `removePage` (which moves the page to `.trash/`) manage them.

Links between pages are written from the site root (`/about/`); export makes them relative.

**The shared theme:**
- The site's own `head.html` holds the theme for every page, with its fonts in the site's `assets/` (served at `/assets/`). The first page of a new site writes it.
- A page created in a site gets `{ site }` (`pageWorkspace`, `siteOf`), so `Workspace.page()` renders `siteHead() + head()`.
- A page whose head contains `NO_SITE_HEAD` (copies of websites) keeps its own look.
- The site head keeps its own small history (`.tykerf/site-head.jsonl`). `shareTheme` moves an older site from per-page themes to a shared one.
- **A page's own values** over the site theme live in a `<style data-tykerf-override>` block of the page's head, with a `:root` block of only the values that differ (`readOverrides`, `withOverrides`, validated like theme values; `themeFonts` includes them, so their fonts come along). Coming after the site's head, they win. Because the page has no `data-tykerf-theme` block, it still counts as using the shared theme.
- **Who `setTheme` changes** (`themeTarget`): on a site's only page it changes the site theme (`SiteLink.setHead`, with the site's own undo; this is how Kaity styles a new site's first page); on a page among others it writes that page's own values over it, so one page's AI never restyles the others.
- **`newPageLike`** copies a page's header, footer, head, types and images, with a `text` section between.
- **The four states** a page's look can be in: inherited; inherited with own values; own theme (a `data-tykerf-theme` block in the page head); own look (`NO_SITE_HEAD`). The Page tab shows which one, from `GET /_tykerf/head` (`sharedTheme`, `overrides`, `ownLook`).

## Layouts, themes and components

`library/` holds:
- `layouts.json`: each layout as a layout plus the component for each box;
- `components/*.html`, listed in `components.json`;
- `theme.html` and `themes.json`: the theme and its presets;
- `fonts/`: Inter, Manrope, DM Sans and Newsreader, under the SIL Open Font License;
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
- **Export** (`export.ts`): renders every page without TYKERF, makes the site-root addresses relative, copies the assets, and reports broken links and files still loaded from other servers. It writes a folder or a zip (`zip.ts`, no dependency).
- **Checks** (`metrics.ts`, `screenshot.ts`): sideways scroll, overflow, line length, tap targets and more, plus screenshots of a block or a page. Playwright is loaded lazily, so the MCP server runs without Chromium.
