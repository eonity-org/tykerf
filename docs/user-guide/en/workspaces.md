# Sites, pages and the notation

## Sites and pages

A **site** is a folder of pages, one subfolder each:

```
my-site/
  home/     a page (layout.slice, boxes/, head.html, assets/ …)
  about/    another page
```

- `npm start -- my-site` on a **new or empty folder** shows the **start screen**. Give the first page a name (`home`) and choose how to start:
  - **Show or describe it:** words, up to three pictures and/or a design ZIP; Kaity builds the page ([Kaity](ai.md#start-a-page-with-kaity)).
  - **A layout:** pick one and a theme while the preview shows them.
  - **A copy of a website:** see [copying a website](importing.md).
- **One theme for the whole site.** The first page's theme becomes the site's: it lives in the site folder's own `head.html` (with its fonts in the site's `assets/`), and every page uses it before its own `head.html`. Change it in the **Page** tab of any page (*Every page*); *Undo the last site theme change* sits next to it. A page can set some values for itself with *This page only*, and the Page tab always says whether a page's look is inherited, inherited with values of its own, its own theme or a copy's own look (see [the theme](layouts.md#the-theme)). Copies of websites keep their own look.
- Sites made before TYKERF shared themes keep a theme per page. The Page tab of one of their pages offers **Use this theme for every page**: it becomes the site's theme, and the other pages drop their own (each one undo step there).
- **The site manager** is at `http://localhost:4400/_tykerf/site/`, and on any page the **Manage the site** button next to *Edit with TYKERF* (or *Manage the site…* in the Site menu) opens it. The site's own address, `http://localhost:4400/`, opens the **home page** once you choose one (**Make home**); until then it shows the manager. `/pages/` lists every page by its title and address, with the home page marked, and the manager's header links to both.
- **The site's icon** (in browser tabs and bookmarks) is made from the home page's first letter on the theme's accent colour. To use your own, open **Styles & scripts** and choose **Upload an icon…** (SVG, PNG or ICO, up to 512 KB); **Use the made one** goes back. While you edit, tabs show TYKERF's mark instead, so the editor's tabs are easy to find; visitors see the site's icon.
- **Titles.** A page is titled by its first heading; **Rename** also sets a title of its own. Titles name the pages in the browser tab, in `/pages/` and in an export.
- **Styles & scripts** in the manager is the code every page gets in its head: a stylesheet, a `<style>`, a `<script>`, meta tags. The theme (colours and fonts) isn't in it: that stays in the Page tab. It has its own **Undo**.
- **The manager** lists the site's pages, each with four icons (their names show when you point at them): **Make home** (the star; the home page's is filled), **Rename**, **Duplicate** (a copy next to it, named `<name>-copy`, without its history or Kaity's conversations) and **Remove**. While Kaity works, **Kaity is working** above the list says where (the whole site, or a page and its block), and her balls pulse next to those pages; each opens the page on that block. **Links between pages** lists the links that point at pages that don't exist (each opens the page on the box it's in), the pages no other page links to, and what each page links to. A removed page goes to the site's trash (its `.trash` folder): **Removed pages** lists them with when they were removed, and **Empty the trash** deletes them for good, after asking. To bring one back meanwhile, move its folder from `.trash` back into the site folder. While Kaity works on a page, that page waits, and so does renaming a page it links to; every other page can be renamed or removed. **+ New page** under the list opens the ways to start one, step by step: choose how to start, and its steps open; the button to make the page always stays in sight. Pages made meanwhile by Claude Desktop or the command line appear there by themselves.
- In the editor each page has its own address (`http://localhost:4400/home/`, `/about/`). The **page name** next to the TYKERF logo lists the site's pages to switch to; **All pages** goes to the site's home, and **New page…** adds one, with the same choices plus **Like this page**: the current page's navigation, footer and theme, with one empty section in between.
- Page names are lowercase letters, digits and `-`: they are folder names and addresses.
- **Links between pages** are written from the site root: `/about/`, `/about/#team`. They work as written in the editor, and exporting the site makes them relative so it works from any address. In a site, the link box (**⌘K** while editing text) and the Text tab's link fields list the site's pages, so you can pick one instead of typing it.
- **Rename this page…** (the pencil next to the current page in that list) renames the page's folder, with its history and conversations with Kaity, and changes every link to it in the other pages. Each page records that as one step you can undo. Open tabs of the page follow it to its new address.
- **Remove this page…** (the bin next to it) says how many links to it will point nowhere, then moves the page to the site's `.trash/` folder. Nothing is deleted: move the folder back to bring the page back.
- Renaming and removing wait while Kaity is working on any page of the site.
- `npm run cli -- render my-site` renders every page into its own `out/`.

A folder that is **one page** (it has a `layout.slice`, like `examples/widgets`) is edited on its own at `http://localhost:4400/`, as before.

## A page

A TYKERF page is a folder, called a workspace:

| File | What it holds |
|---|---|
| `layout.slice` | The tree, in slicing notation |
| `boxes/<id>.html` | Each box's code: any HTML, with its own `<style>` (applies only to that box) and `<script>` |
| `types/<type>.json` | Optional box types: what may go where, which tags and scripts a box may use |
| `head.html` | The page `<head>` additions: the theme, fonts, page-wide styles and scripts (the Page tab) |
| `assets/` | Images and files the boxes use, as `assets/<file>`; copied to `out/assets/` when rendering. Files nothing uses go to `.trash/` from the Page tab (*Unused files*) |
| `.history.jsonl` | Every change, with who made it (`user` or `ai`), for undo and audit |
| `.redo.jsonl` | Undone changes that Redo can bring back (cleared by the next new change) |
| `.images.json` | Images the image tool cropped, turned or scaled, and the original each came from (so a crop can be undone) |
| `.tykerf/` | Editor state: conversations with Kaity, attached images, the removed-code buffer (not for git) |
| `out/` | The rendered page, `index.html` (not for git; regenerate it with `npm run cli -- render <folder>`) |

## The notation in one minute

```
header  sidebar main V{1:3}  footer  H3
```

- Names are blocks. `V` puts the blocks before it **side by side** (a row); `H` **stacks** them (a column).
- The operator comes **after** its blocks (postfix), and a number says how many it takes: `H3` stacks three things.
- `{1:3}` gives the row's widths as shares: the main column is three times the sidebar.

So this page is a header, then a row with a narrow sidebar and a wide main area, then a footer. You rarely write it by hand: the editor and Kaity change it for you. The full grammar, including responsive rules, overlays, references and box types, is in [the notation spec](../../slicing-notation.md).
