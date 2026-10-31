<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../README.md) › [Roadmap](../../ROADMAP.md) › **Plan: sharing styles, scripts, blocks and attributes across a site**
<!-- /tykerf:header -->

# Plan: sharing styles, scripts, blocks and attributes across a site

Status: **built** (October 2026), all four phases, with the open questions settled as proposed: the folder is `kit/`; shared blocks differ per page only by what the renderer derives (the current page's link); Kaity changes the kit only from the site run; `nav` and `footer` become shared when someone shares them (and new pages then link them). One change from this plan: kit styles render in a fixed order (theme, kit, page, box) rather than in cascade layers, because TYKERF's base styles are unlayered and layering them would turn their cascade around. Where it lives: `src/kit.ts`, `docs/developer-guide/en/architecture.md#sites`, `docs/user-guide/en/sites.md#the-site-kit`.

## Where we are

A site is a folder of pages. Today these are shared:

| Shared today | Where | Notes |
|---|---|---|
| Theme variables and fonts | `<site>/head.html`, theme and fonts blocks | The Page tab edits them; a page can set its own values over them (`data-tykerf-override`) |
| Free styles and scripts | the rest of `<site>/head.html` (*Styles & scripts* in the manager) | One free-form block of code, no structure, no order beyond the file's |
| Pictures and files | `<site>/assets/` at `/assets/` | Shared by address only; there's no media view yet (site-manager plan, item 2) |
| Links between pages | root-absolute `/page/` | Follow renames |

And these are **not** shared, so they are copied and then drift:

1. **Blocks.** A component is copied into each box when a page is made. The navigation and the footer exist once per page: changing the menu means changing every page (or asking Kaity to).
2. **CSS beyond the theme.** A box's CSS is scoped to that box. A rule several boxes need (a button style, a card) is either repeated in each box or written by hand in *Styles & scripts*, where nothing orders or names it.
3. **JavaScript.** A script lives inside a box (the contact form's) and is copied with it. Two forms on two pages carry two copies.
4. **Attributes.** Tags (`#tone-dark`, `#dense`, `#reverse`) are a fixed set defined by the library theme. A site can't add its own (`#highlighted`, `#narrow`), so people write one-off CSS.
5. **Box types** (`types/<type>.json`) are per page; a site that wants the same rules on every page copies them.

## The idea: a site kit

A reserved `<site>/kit/` folder holds what every page of the site shares, each kind in its own place, each file small and named, so people, Kaity and any agent can find and change one thing:

```
my-site/
  head.html            theme and fonts (as today)
  site.json
  assets/
  kit/
    styles/            site CSS, in cascade layers
      base.css
      buttons.css
      tags.css         the site's own tags (see 4)
    scripts/           behaviours: one ES module each
      reveal.js
      carousel.js
    blocks/            shared blocks: one box's code each
      nav.html
      footer.html
    types/             box types for every page
      card.json
  home/  about/  …     pages (as today)
```

`kit` joins `assets`, `out`, `pages` and `sitemap.xml` as a reserved name a page can't take.

### 1. Site styles, in layers

Every page renders the kit's styles in one fixed order of **cascade layers**, so what wins is never a matter of file order:

```css
@layer theme, kit, page, box;
```

- `theme`: the theme variables and base (today's theme block).
- `kit`: `kit/styles/*.css`, in name order (`base.css` first by convention).
- `page`: the page's own head styles.
- `box`: each box's scoped `<style>` (today's `@scope` blocks).

The editor serves the kit at `/kit/styles.css` (all files joined, cached until one changes). An export inlines or copies it like `assets/`. Components keep working without a kit: the layer only adds rules.

**Editing:** *Styles & scripts* in the site manager becomes a list of the kit's files with an editor for each: new file, rename, remove, each with undo. The free-form head code stays for what isn't CSS or JS (meta tags, analytics snippets).

### 2. Shared blocks (linked boxes)

A box can show a **shared block** instead of its own code. The leaf says which:

```
nav[role=header use=nav] … H@page
```

- **Rendering:** a box with `use=<block>` renders `kit/blocks/<block>.html` (scoped to the box as usual). Its own `boxes/<id>.html` is ignored while it's linked.
- **Editing it changes every page.** Editing a linked box in the editor (text in place, the Text or Code tab) writes the shared file, after a clear notice: *This block is shared by 8 pages; changes apply to all of them.* Undo works across pages (one site history entry).
- **Unlink:** *Make this page's own copy* copies the block's code into the box and drops `use=`. Nothing else changes.
- **Share a box:** *Share with every page…* moves a box's code to `kit/blocks/<name>.html` and links it here. *Use on another page* links it in the chosen page's box. For an existing site, TYKERF offers to link boxes whose code is already identical across pages (typically `nav` and `footer`).
- **Small differences per page** (the current page highlighted in the menu, a page-specific title) come from attributes the block reads, not from copies: the renderer marks the current page's link with `aria-current="page"` (as the site-manager plan's menu does), and later `data-slot` values could fill named slots per page.
- **New pages:** a layout's `nav` and `footer` boxes link to the site's shared blocks when the site has them, instead of copying the library component again.

### 3. Behaviours (shared scripts)

A script that several boxes need becomes a **behaviour**: one ES module in `kit/scripts/<name>.js`, exporting a function that receives one element:

```js
// kit/scripts/reveal.js
export default function reveal(el) {
  const io = new IntersectionObserver(([e]) => el.classList.toggle('shown', e.isIntersecting));
  io.observe(el);
  return () => io.disconnect(); // called when the editor re-renders the page
}
```

Markup opts in with an attribute: `<section data-use="reveal">`. A tiny loader (part of the rendered page, a few lines) finds `[data-use]` elements and calls each behaviour once per element. It loads only the modules the page uses, and runs them again after the editor re-renders.

- Box scripts keep working; behaviours are for what's shared.
- The library's own scripts (the contact form's) can move to behaviours that ship with the library and are copied into `kit/scripts/` when a page first uses them, as fonts are today.
- Security is as today: scripts run on the editor's origin (SECURITY.md, accepted risk). The kit doesn't widen it, but it makes scripts easier to review: one file per behaviour.

### 4. Site tags (shared attributes)

`kit/tags.json` declares the site's own tags next to the library's:

```json
{ "highlighted": { "label": "Highlighted", "group": "look", "description": "A thin accent border and a soft background" } }
```

The CSS for each tag goes in `kit/styles/tags.css` as `.t-highlighted { … }` (the class tags already render as). The **Size & look** tab lists the site's tags next to *Band* and *Density*, so a person tags a block without writing CSS. Kaity sees them through `get_types`/`get_theme` (or a new `list_tags`), with their descriptions.

Custom values can join the theme: variables the site adds to its theme block (`--brand-stripe: …`) appear in the Page tab under *This site's own values*, checked like theme values.

### 5. Site box types

`kit/types/*.json` apply to every page. A page's own `types/` still wins for a type of the same name. `get_types` says where each type comes from.

## Kaity, MCP and safety

- **What Kaity may change.** The kit changes every page, so a request scoped to one block can't change it, as the site head today. Kaity changes the kit only from the site manager (the site run), and her answer lists every page the change reaches. New MCP tools for that run: `list_kit`, `get_kit_file`, `set_kit_file` (styles, scripts, blocks, tags, types), `link_block`, `unlink_block`.
- **Checks.** Kit CSS gets the same refusals as theme values where it matters (no `@import`, no `url()` to other servers); scripts are files Kaity writes like box scripts today. `check_page` also reports a linked box whose block file is missing.
- **History.** One site history (`.tykerf/site-history.jsonl`) for the head and the kit, with undo and redo in the manager. A page's undo never reaches the kit.
- **Locking.** Kit writes run under the site's store lock. A change reloads every open page of the site (as a head change does today).
- **Export and publish.** `kit/styles` becomes `/kit/styles.css`; `kit/scripts` are copied; blocks are rendered into each page. Nothing of the kit's source layout is needed by a visitor.

## Phases

| Phase | What | Why first |
|---|---|---|
| 1 | Site styles in layers (`kit/styles`, `@layer`, the manager's file list) and site tags | Smallest change, unblocks clean shared CSS today, no change to how boxes render |
| 2 | Shared blocks (`use=`, share / unlink, linking identical `nav`/`footer`) | The biggest win: one menu and one footer for the whole site |
| 3 | Behaviours (`kit/scripts`, `data-use`, the loader, the library's scripts as behaviours) | Needs phase 1's serving and export path |
| 4 | Site box types, custom theme values, the MCP tools and Kaity's site-run rules | Builds on all of the above |

Each phase ships with tests (rendering order, linking and unlinking with undo, export output, scope refusals), the developer guide (`architecture.md#sites`, `editor.md`, `ai-and-mcp.md`) and the user guide (`sites.md`).

## Open questions

1. **The folder's name.** `kit/` (proposed), `shared/` or `_site/`. It's visible in exports' file lists and in people's folders.
2. **Per-page differences in shared blocks.** Only what the renderer derives (the current page's link) in phase 2, or named slots (`data-slot`) with per-page values from the start?
3. **Kaity and the kit.** Site run only (proposed), or also from a page's top block with a confirmation in the chat?
4. **Library components that are shared by nature.** Should `nav` and `footer` start linked in every new site, or only after someone chooses *Share with every page*?

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
