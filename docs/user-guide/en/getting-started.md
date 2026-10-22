<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20" style="border-radius:0">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Getting started**
<!-- /tykerf:header -->

# Getting started

This page takes you from nothing to a first page you can edit, and explains the ways to start a site. To see why you might want TYKERF at all, read [Why TYKERF](why-tykerf.md) first.

## Install

You need [Node.js](https://nodejs.org) 22 or later. For Kaity, TYKERF's assistant, you need one of these:
- [Claude Code](https://claude.com/claude-code), installed and signed in. This is the default, and TYKERF needs no key of its own.
- An API key for Anthropic, an Anthropic-compatible service or Gemini (see [Which AI answers](ai.md#which-ai-answers)).

```bash
git clone https://github.com/eonity-org/tykerf.git
cd tykerf
npm install
npx playwright install chromium     # a browser TYKERF uses for screenshots, checks and copying websites
```

## Start a site

A **site** is a folder of pages. Start TYKERF on a new or empty folder:

```bash
npm start -- ~/tykerf-sites/bakery
```

Open http://localhost:4400 (another port: add `--port 4500`). The **start screen** asks for the first page's name (`home` is fine) and how you want to start.

## Three ways to start

### 1. Show or describe it, and Kaity builds it

The quickest way, and the first choice when Kaity is ready.

1. **Show it:** drop, paste or choose up to three pictures: a screenshot of a page you like, a sketch on paper, a mock-up. You can also drop a design exported as a ZIP file (from Google Stitch, for example): Kaity gets its pictures and reads its text files (the design notes, the page's HTML and CSS) to follow its colours, fonts and sections.
2. **Describe it:** write what the page should be. Be concrete about who it is for, what it must say, and the feel:
   > A launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map.

   Either one is enough; both together work best.
3. Leave the theme on **Kaity chooses** (it picks the preset that fits, or takes the colours and fonts of your design), or pick one yourself. Then choose **Build it with Kaity**.

The page starts empty. Kaity starts from the page layout that fits your request best (a launch page, a magazine, a portfolio, a data page…), then shapes it and rewrites all its text for you.

TYKERF makes the page at once and opens it, with a small card in the corner that shows Kaity's work step by step. The editor stays out of sight meanwhile: the page fills in behind the window as Kaity builds it, and you can't click it until Kaity is done:
- it plans the sections and starts each from a ready-made component;
- it writes the text, alternates light and tinted bands, and puts a dark footer at the end;
- it looks at the result at desktop and phone width and fixes what looks wrong.

It takes a few minutes and uses your AI account. The **×** stops it; what it built so far stays.

When it is done, the window shows Kaity's summary and a short guide to go on. Then choose:
- **Open the editor:** you land on the page's **Kaity** tab, where you can keep talking ("make the hero shorter", "add a pricing section");
- **See the page:** you see it as visitors will. **Edit with TYKERF**, at the bottom right, opens the editor any time.

Every step is an ordinary change, so you can undo any of them.

**Best for:** a page you can picture or describe, or a design you saw somewhere and want something like it.

### 2. A copy of a website

TYKERF opens an existing page in a browser, measures it at desktop and phone widths, and cuts it into rows, columns and boxes you can edit. Write the address and choose **Copy the page**. Tick **Only the layout** to keep the structure without the site's text, images and styles. The page opens at once, with a window that follows the copy: opening the site, measuring it, cutting it into blocks, copying the styles. It usually takes under a minute. When it is done, choose **Open the editor** or **See the page**. The **×** stops the copy and removes the unfinished page (to the site's `.trash/` folder).

**Best for:**
- moving your own site into TYKERF;
- starting from a structure you like.

Read [what you may do with a copy](importing.md#what-you-may-do-with-the-copy) before you publish one: a copy of someone else's site is for studying and prototyping only. You can also copy just one part of a site into a box later (*Import a section…*, see [Copying a website](importing.md)).

### 3. A layout

Pick a page layout and a theme while the preview shows them at desktop or phone width. Then replace the placeholder text and images, or ask Kaity to fill them in ("fill this page for a bakery in Murcia").

| Layout | For |
|---|---|
| Product launch | A big headline over the product, features, numbers, quotes, pricing, FAQ (airy) |
| Company | A statement, the latest news, what you do, numbers |
| Magazine | A front page of stories with a most-read list (packed) |
| Catalogue | Products or services in a grid of cards, with filters (packed) |
| Portfolio | A statement, a gallery of work, quotes, contact |
| Article, Documentation, Blank | Reading pages, and an almost empty start |

The six themes cover different styles: *Studio* (airy), *Product* (packed), *Ivory* (editorial), *Gallery* (soft), *Dark* (for developers) and *Warm* (warm editorial, a serif over a sans, gilt details). Any layout works with any theme, so the pair sets the page's colour, type and density.

A layout is a whole page made of **components**, ready-made sections such as a hero, features or pricing. Later you can drop any component into any box on its own (*Use a component*), and the **theme** styles them all; see [how they differ](layouts.md).

**Best for:**
- a solid layout in seconds;
- when Kaity isn't set up yet;
- when you'd rather write every word yourself.

### Which one?

| You have… | Start with |
|---|---|
| An idea, a sketch or a screenshot of a page you like | **Show or describe it** |
| A site already (yours), or a layout you want to study | **A copy of a website** |
| No AI set up yet, or you want to write every word | **A layout** |

None of these locks you in. Every page, however it started, is the same kind of TYKERF page: you can edit it by hand, ask Kaity about any block, use components and change the theme.

## More pages

Click the page name next to the TYKERF logo and choose **New page…**. You get the same three ways, plus one more:

- **Like this page:** the current page's navigation, footer and theme, with one empty section in between. This is the fastest way to grow a site that looks consistent.

**One theme for the whole site.** All the pages of a site share the theme the first page set: its colours, fonts and spacing. Change it in the **Page** tab of any page and every page follows. A page can still set its own colours or fonts with *This page only*, and the Page tab always says whether a page's look is inherited from the site (see [the theme](layouts.md#the-theme)).

## What next

- **[Edit the page](editor.md):**
  - select blocks;
  - change text and images where they are, by double-clicking;
  - add, move and resize blocks;
  - undo anything.
- **[Ask Kaity about one block](ai.md):** select a block, open the **Kaity** tab and say what you want. Kaity can only change that block.
- **[Manage the site](sites.md):** the **Manage the site** button next to *Edit with TYKERF* opens the site manager: the home page, titles, the site's icon, links between pages, and pages to rename, duplicate or remove. The link box (⌘K) lists the site's pages, and renaming a page updates every link to it.
- **[Put it online](publishing.md):** **Publish** in the site manager sends the site to GitHub Pages, Cloudflare Pages or Netlify; *Site → Export the site…* gives a .zip of plain files for any web host.

<!-- tykerf:footer -->
---

← [Why TYKERF](why-tykerf.md) · [User guide index](README.md) · [Editing a page](editor.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
