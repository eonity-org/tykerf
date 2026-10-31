<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Your site**
<!-- /tykerf:header -->

# Your site

A **site** is a folder of pages, one subfolder each, with what they share next to them:

```
my-site/
  home/          a page (layout.slice, boxes/, head.html, assets/ …)
  about/         another page
  head.html      the site's theme and the code every page gets (Styles & scripts)
  kit/           what every page shares besides the theme (see The site kit)
  assets/        the theme's fonts
  site.json      the home page, titles set by hand, where Publish sends the site
  favicon.svg    the site's icon, when you upload one (.svg, .png or .ico)
  .trash/        removed pages, until you empty the trash
```

`npm start -- my-site` opens it at `http://localhost:4400`. Every page is in a site: the first page you make in a new or empty folder (from the start screen, `--layout`, `npm run cli -- new` or Claude) is the site's **home page**, named `home` unless you name it, and the site's address opens it. To name it, change **Page name** on the start screen, or give `--name`:

```bash
npm start -- my-site --layout biased --name portfolio      # a site whose one page is /portfolio/
npm run cli -- new my-site biased --name portfolio         # the same, without opening the editor
```

The site manager's name field renames it later; it stays the home page.

On a site that has pages already, `--layout` with `--name` adds that page, once (it says so, with the page's address); the same command run again just starts the editor. In a site that shares one theme, the theme you name becomes that page's own values, so the other pages keep their look. Without `--name`, it asks for one:

```bash
npm start -- my-site --layout biased --theme biased --name case-two   # one more page, /case-two/
``` Starting TYKERF on one page of a site (`npm start -- my-site/home`) opens its site. A page folder that isn't in a site is refused, with the two commands that put it in one:

```bash
mkdir my-site && mv my-page my-site/home
npm start -- my-site
```

![The site manager: its actions, the pages with their icons, and Styles & scripts open with the site's icon](../images/site-manager.png)

## The first page

On a **new or empty folder**, TYKERF shows the **start screen**. Give the first page a name (`home`) and choose how to start:
- **Show or describe it:** words, up to three pictures and/or a design ZIP; Kaity builds the page ([Kaity](ai.md#start-a-page-with-kaity)).
- **A layout:** pick one and a theme while the preview shows them ([layouts](layouts.md)).
- **A copy of a website:** see [copying a website](importing.md).

Page names are lowercase letters, digits and `-`: they are folder names and addresses (`/home/`, `/about/`).

## The site manager

The site manager is at `http://localhost:4400/_tykerf/site/`. From any page, the **Manage the site** button next to *Edit with TYKERF* opens it, and so do *Manage the site…* in the Site menu and **All pages** in the page list. Until the site has a home page, `http://localhost:4400/` opens it too.

It starts with what acts on the whole site:

| Button | What it does |
|---|---|
| **+ New page** | The ways to start a page, step by step; the button that makes the page always stays in sight |
| **Ask Kaity about the whole site** | Kaity works across pages: she opens each, changes it and checks it ([Kaity for the whole site](ai.md#kaity-for-the-whole-site)) |
| **Styles & scripts** | The site's icon, and the code every page gets in its head (see below) |
| **Links between pages** | Broken links first, then the pages nothing links to (see below) |
| **Kaity's work** | Everything Kaity did and is doing in the site, on any page or the whole site (see below) |
| **Publish** | The site, live on GitHub Pages, Cloudflare Pages or Netlify ([publishing](publishing.md)) |

### The pages

Each page shows its name, its address and its title, and five icons; their names show when you point at them. The **name** opens the page as visitors see it (*Edit with TYKERF* is there when you want it).

- **Make home** (the star): visitors get this page at the site's address (`/`). The home page's star is filled.
- **Edit** (the pencil): opens the page with the editor open, as the pencil means everywhere in TYKERF.
- **Name and title** (a name field): the page's name (its folder and address) and its **title**. Without a title of its own, a page is titled by its first heading. Titles name the pages in the browser tab, in the list of pages and in an export.
- **Duplicate**: a copy of the page next to it, named `<name>-copy`, ready to rename. The copy doesn't bring the page's history or its conversations with Kaity.
- **Remove** (the bin): after asking, the page goes to the site's trash (its `.trash` folder). **Removed pages** lists them with when they were removed, and **Empty the trash** deletes them for good, after asking again. Until then, move a page's folder from `.trash` back into the site folder to bring it back.

Pages made meanwhile by Kaity, Claude Desktop or the command line appear in the list by themselves.

### Where Kaity is working

While Kaity works, **Kaity is working** appears above the list: the whole site, or each page with the block she's on. Her three balls pulse next to those pages, and each one opens the page on her block's Kaity tab. In the page itself, the block she works on carries her balls in the tree, and any other block's Kaity tab says where she is, with **Go there**.

A page Kaity is working on waits: it can't be renamed, removed or duplicated until she finishes. Nor can a page it links to be renamed, so those links can follow the new name. Every other page can.

### Kaity's work

Kaity can work on several pages at once, a block on each, so on a site of many pages you need one place to see it all. **Kaity's work** (also *All of Kaity's work* under **Kaity is working**, and *Kaity's work across the site…* in the editor's Site menu) lists every request she had, newest first, with the ones going on now at the top:

- where: the page and its block, or **The whole site**; each opens the page on that block's Kaity tab, with the whole conversation;
- what you asked, word for word (tasks included), when, and how long it took;
- how it ended: **Done**, **Didn't finish** (with what went wrong), **Stopped**, or **Cut short** when TYKERF stopped while she worked; while she works, what she is doing right now;
- **Her answer**, and how many steps she took.

**Show** keeps to one page, or to the whole site. The list is kept in the site's `.tykerf/kaity.jsonl`, the last thousand requests or so.

### Links between pages

Links between pages are written from the site root: `/about/`, `/about/#team`. They work as written in the editor, and an export makes them relative, so the site works at any address. While you edit text, the link box (**⌘K**) and the Text tab's link fields list the site's pages to pick from. Renaming a page changes every link to it, in every page, as one undo step on each.

![Links between pages in the site manager](../images/links.png)

**Links between pages** in the manager shows:
- **links to pages that don't exist**, each opening the page on the box that holds it (its Text tab), so you can fix it;
- **pages no other page links to:** visitors reach them only from the list of pages or a search engine;
- **what each page links to.**

### Styles & scripts

The code every page gets in its head, before the page's own: a stylesheet, a `<style>`, a `<script>`, meta tags. Scripts here run on every page. The theme (colours and fonts) isn't in it; that stays in the Page tab. It has its own **Undo**.

Above the code is **the site's icon**, the one browser tabs and bookmarks show. TYKERF makes one from the home page's first letter on the theme's accent colour. **Upload an icon…** uses yours instead (SVG, PNG or ICO, up to 512 KB), and **Use the made one** goes back. While you edit, the editor's tabs show TYKERF's mark instead, so they're easy to find; visitors see the site's icon.

## The site kit

The site kit holds what every page shares besides the theme, one small named file each, in the site's `kit/` folder. It opens below **Styles & scripts** in the site manager: each kind lists its files (click one to edit it, **+ New** to add one), and **Undo** takes back the last change.

| Kind | What it is | Where it shows |
|---|---|---|
| **Styles** (`kit/styles/<name>.css`) | CSS for every page: a button style, a card | In every page, after the theme and before the page's own styles, in file-name order |
| **Behaviours** (`kit/scripts/<name>.js`) | A small script an element turns on with `data-use="<name>"`: `export default function (el) { … }` | On the elements that ask for it, on any page; only the behaviours a page uses load |
| **Shared blocks** (`kit/blocks/<name>.html`) | One box's code that several pages show: the navigation, the footer | In every box that shows it (see below) |
| **Box types** (`kit/types/<name>.json`) | Rules for boxes of a type (see box types) | On every page; a page's own type of the same name wins |
| **Tags** (`kit/tags.json`) | The site's own tags, with a label and a description | In the editor's **Size & look** tab, under *Site tags*; style each as `.t-<tag>` in a styles file |

**Shared blocks.** A navigation or a footer is the same on every page, so it should be one thing:
- The kit lists the boxes that are already the same on several pages (*These boxes are the same on several pages…*). **Share nav** makes one shared block from it and shows it on all of those pages.
- In the editor, **Share…** on a box does the same from one page; the dialog also offers the site's other shared blocks to show instead.
- A box that shows a shared block has a **shared** chip in the tree and a notice above its tabs. A change to it (its text, its code, Kaity's) changes every page that shows it; the site manager's **Undo** takes that back, not the page's.
- **Make this page's own copy** gives this page the block's code as it is now, to change on its own; the other pages keep the shared block. It's one undo step on the page.
- A link to the page you're on, inside a shared block, is marked as the current page (`aria-current`), so a menu can show where you are.
- A new page whose layout has a box with the same name as a shared block (`nav`, `footer`) shows the shared block from the start.

Kaity changes the kit only when you ask her for the whole site in the site manager, and she says which pages a change reaches. Asked about one block, she can't change a shared block; she'll suggest making the page's own copy. Exports and Publish include the kit: its styles in each page, its behaviours as files.

## One theme for every page

The first page's theme becomes the site's: it lives in the site's own `head.html` (with its fonts in the site's `assets/`), and every page uses it before its own `head.html`. Change it in the **Page** tab of any page (*Every page*); *Undo the last site theme change* sits next to it. A page can set some values for itself with *This page only*, and the Page tab always says where a page's look comes from (see [the theme](layouts.md#the-theme)). Copies of websites keep their own look.

Sites made before TYKERF shared themes keep a theme per page. The Page tab of one of their pages offers **Use this theme for every page**: it becomes the site's theme, and the other pages drop their own (one undo step on each).

## Moving between pages

In the editor each page has its own address (`http://localhost:4400/home/`). The **page name** next to the TYKERF logo lists the site's pages to switch to; **All pages** opens the site manager, and **New page…** adds one, with the same choices as the start screen plus **Like this page**: the current page's navigation, footer and theme, with one empty section in between.

Next to the current page in that list, **Rename this page…** (the name field) and **Remove this page…** (the bin) do what the manager's icons do; removing first says how many links to it will point nowhere. Open tabs of a renamed page follow it to its new address.

## The site's addresses

| Address | What it is |
|---|---|
| `/` | The home page (until there is one: the site manager, or for visitors the list of pages) |
| `/<page>/` | A page |
| `/pages/` | Every page by title and address, the home page marked, in the site's theme |
| `/sitemap.xml` | For search engines, when the site's public address is set (`TYKERF_PUBLIC_URL`) |
| `/favicon.svg` | The site's icon (`.png` or `.ico` when you upload one) |
| `/_tykerf/site/` | The site manager |

`pages` and `sitemap.xml` can't be page names. `npm run cli -- render my-site` renders every page into its own `out/`.

To put the site online, see [Publishing and serving](publishing.md).

<!-- tykerf:footer -->
---

← [Copying a website](importing.md) · [User guide index](README.md) · [Publishing and serving a site](publishing.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
