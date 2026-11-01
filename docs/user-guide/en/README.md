<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › **TYKERF user guide**
<!-- /tykerf:header -->

# TYKERF user guide

TYKERF lets people and its assistant, Kaity, build and change a web page together, one block at a time. A page is a tree of blocks: rows and columns, down to boxes that hold ordinary HTML. Every block has a name, every change is a validated move, and every change can be undone.

The quickest way to change a page is to **point at it**: click anything, write what should change, and give your tasks to Kaity (see [Tasks](editor.md#tasks)).

**New here?** Read [Why TYKERF](why-tykerf.md), then [Getting started](getting-started.md). Or watch Kaity build a page from one sentence first, and then do two tasks you leave on it:

[![Watch Kaity build a page about Lisbon from one sentence (2:48)](../../media/tykerf-builds-lisbon.jpg)](https://eonity.org/tykerf-guides/videos/tykerf-builds-lisbon.mp4)

[![Watch two tasks given to Kaity on a page about London (1:40)](../../media/tykerf-tasks.jpg)](https://eonity.org/tykerf-guides/videos/tykerf-tasks.mp4)

| Guide | For |
|---|---|
| [Why TYKERF](why-tykerf.md) | What TYKERF does differently, and when it is (and isn't) the right tool |
| [Getting started](getting-started.md) | Install, start a site, and the ways to start a page: with Kaity, from a website, from a layout |
| [Editing a page](editor.md) | **Tasks** (point at anything and give it to Kaity), then the **Edit** mode: the panel, selecting blocks, editing text and images in place, code, sizes, deleting and pasting |
| [Working with Kaity](ai.md) | Starting a page with Kaity, giving her tasks, asking about one block, images, which AI answers, using TYKERF from other AI clients |
| [Getting good results from Kaity](asking-kaity.md) | How to write a request or a task, leaving tasks block by block, checking her work, and recipes: a page from one sentence, from a picture, a consistent site |
| [Layouts, components and the theme](layouts.md) | Layouts, ready-made sections, the site's colours and fonts, band tones, images |
| [Copying a website](importing.md) | A page from an existing site, or one of its sections in a box, and what you may do with the copy |
| [Your site](sites.md) | The site manager: pages, the home page, titles, the site's icon, styles and scripts for every page, the site kit (one navigation and footer shared by every page, small behaviours), links between pages, where Kaity is working, the trash |
| [Publishing and serving](publishing.md) | Publish to GitHub Pages, Cloudflare Pages or Netlify; serve the site with TYKERF and sign in to edit it |
| [Exporting](exporting.md) | A page or a whole site as plain files for any web host |
| [Pages and the notation](workspaces.md) | What is in a page folder, the slicing notation, box types |
| [TYKERF in Claude Desktop](claude-desktop.md) | Installing the extension and letting Claude Desktop change a page |
| [TYKERF in Claude Code and Cowork](claude-plugin.md) | The plugin: installing it, the folder Claude opens, what it needs |
| [When something goes wrong](troubleshooting.md) | What TYKERF's messages mean and what to do: starting it, Kaity not ready, keys, refused changes, publishing |

To set up a server, see [DEPLOY.md](../../../DEPLOY.md). To work on TYKERF itself, see the [developer guide](../../developer-guide/README.md).

## Quick start

```bash
npm install
npx playwright install chromium
npm start -- ~/tykerf-sites/my-site      # open http://localhost:4400
```

A new or empty folder is a new site. The start screen offers three ways to start the first page (a fourth, *Like this page*, joins them once the site has a page):
- **Show or describe it:** Kaity builds the page from your words and pictures.
- **A layout:** with a theme.
- **A copy of a website.**

**+ New page** in the site manager (or *New page…* in the editor's page list) adds more pages, and all the pages share one theme. **Publish** in the site manager puts the site online. The first page is the site's home page, which its address opens. To start a site with its home page from a layout directly: `npm start -- my-site --layout launch --theme studio` (add `--name portfolio` to name that page other than `home`).

<!-- tykerf:footer -->
---

[Why TYKERF](why-tykerf.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
