<!-- tykerf:header -->
[<img src="../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20">](../../README.md) › [Roadmap](../../ROADMAP.md) › **Site manager**
<!-- /tykerf:header -->

# Site manager

Status: **mostly built** (October 2026). TYKERF manages a whole site: a folder of pages with a shared theme, a home page, a list of pages, styles and scripts for every page, Kaity working across pages, exports, and serving the site to visitors. Sections (nested folders) and media are still to do. The rest of this file says what is built, where it differs from the first plan, and what is left.

## What was asked
A place to manage a site: rename pages, sections where pages live, links, multimedia, common styles. The user's choices: sections are folders of pages plus a `site.json`; a shared site head; a shared site `assets/`; links that follow renames, with a navigation menu and a link picker. Later: a home page at `/` and a generated list of pages (both); visitors see plain pages and the admin signs in with a password from `.env`; the site head's code edited in the manager.

## Built

- **The manager** (`src/editor/public/start.html`) at `/_tykerf/site/`. Actions come first: **+ New page** (the chooser, step by step), **Ask Kaity about the whole site** and **Styles & scripts**. Then the pages, which scroll on their own: name, address (`/rome/`), title, **Make home**, **Rename** (name and title), **Remove**. Then the trash (**Empty the trash**) and **Sign out** when sign-in is on. It shows the restart notice when the server's code changed.
- **Reaching it:** the **Manage the site** button next to *Edit with TYKERF*, *Manage the site…* in the Site menu, **All pages** in the page list, and `/` while the site has no home page.
- **`site.json`** (`readSite`/`setHome`/`setTitle`/`pageTitle` in `src/site.ts`): `{ "version": 1, "home": "rome", "titles": { "rome": "Rome" } }`, reconciled with the disk on every read, updated by renames and removals. A page without a title of its own is titled by its first `<h1>`, else its name.
- **The site's addresses:** `/` opens the home page, `/pages/` lists the pages (`siteIndex`: title, address, home marked, in the site's theme, with the TYKERF mark and the way to sign in at the bottom), `/sitemap.xml` with `TYKERF_PUBLIC_URL` (`siteMap`). `pages` and `sitemap.xml` are reserved names.
- **Shared theme and Styles & scripts:** `<site>/head.html` renders before each page's head. The Page tab edits its theme; the manager's *Styles & scripts* edits the rest (`siteCode`/`setSiteCode`, which never change the theme and fonts blocks, `KEPT`), with its own undo (`.tykerf/site-head.jsonl`). Kaity and MCP don't change the site head.
- **Links between pages** are root-absolute (`/about/`) and follow renames (`renamePage` + `rewriteLinks`); the link picker lists the site's pages. Removed pages go to `.trash/`.
- **Kaity for the whole site** (`siteAI` in `server.ts`): one conversation in the manager, with `list_pages`/`open_page`/`new_page`, like Claude Desktop. A page run and the site run wait for each other. `use_page` makes a page like another.
- **Pages:** each row's actions as icons (make home, rename, duplicate, remove); **Kaity is working** lists her runs across the site, each opening the page on her block (`?block=&tab=`); **Links between pages** shows broken links first, pages nothing links to, and each page's links.
- **Exports** (`src/export.ts`): the whole site (`index.html` opens the home page, `pages/index.html`, `sitemap.xml` with a public address) or, with *Export this page…*, one page with the site's theme and fonts.
- **Serving to visitors** (`src/editor/auth.ts`): with `TYKERF_ADMIN_PASSWORD`, visitors get the pages without the editor, and every `/_tykerf/` address needs the admin's session (sign-in at `/_tykerf/login`). See `DEPLOY.md`.

## Different from the first plan
- **No dialog with tabs** (`public/site.js`): the manager is its own page, which also works as the site's front door before it has a home page.
- **No `Site` class**: the functions in `src/site.ts` work on the folder, each change under the store lock.
- **Titles and the home page only** in `site.json`, not an ordered tree of items: the order is the folder's, with the home page first.

## Still to do
1. **Sections:** folders of pages (`/blog/post-1/`), with `/blog/` opening its first page, at most 3 deep; routing by the longest matching prefix; `items` in `site.json` for order and nesting.
2. **Media:** the site's `assets/` as a grid, upload and delete, with the pages that use each file.
3. **A navigation menu filled from the site:** `<nav data-tykerf-menu></nav>` filled at render time, with `aria-current`, and a "Site menu" component.
4. **Reorder pages** in the manager (needs the order in `site.json`).

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
