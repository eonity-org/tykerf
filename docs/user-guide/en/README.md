# TYKERF user guide

TYKERF lets people and its assistant, Kaity, build and change a web page together, one block at a time. A page is a tree of blocks: rows and columns, down to boxes that hold ordinary HTML. Every block has a name, every change is a validated move, and every change can be undone.

**New here?** Read [Why TYKERF](why-tykerf.md), then [Getting started](getting-started.md).

| Guide | For |
|---|---|
| [Why TYKERF](why-tykerf.md) | What TYKERF does differently, and when it is (and isn't) the right tool |
| [Getting started](getting-started.md) | Install, start a site, and the ways to start a page: with Kaity, from a website, from a layout |
| [Editing a page](editor.md) | The panel, selecting blocks, editing text and images in place, code, sizes, deleting and pasting |
| [Working with Kaity](ai.md) | Starting a page with Kaity, asking about one block, images, which AI answers, using TYKERF from other AI clients |
| [Layouts, components and the theme](layouts.md) | Layouts, ready-made sections, the site's colours and fonts, band tones, images |
| [Copying a website](importing.md) | A page from an existing site, or one of its sections in a box, and what you may do with the copy |
| [Sites, pages and the notation](workspaces.md) | Pages of a site, links between them, the shared theme, what is in a page folder, box types |
| [Exporting](exporting.md) | A page or a whole site as plain files for any web host |
| [TYKERF in Claude Desktop](claude-desktop.md) | Installing the extension and letting Claude Desktop change a page |

To run TYKERF for others or publish pages, see [DEPLOY.md](../../../DEPLOY.md). To work on TYKERF itself, see the [developer guide](../../developer-guide/README.md).

## Quick start

```bash
npm install
npx playwright install chromium
npm start -- ~/tykerf-sites/my-site      # open http://localhost:4400
```

A new or empty folder is a new site. The start screen offers three ways to start the first page:
- **Show or describe it:** Kaity builds the page from your words and pictures.
- **A layout:** with a theme.
- **A copy of a website.**

*New page…* in the editor adds more pages, and all the pages share one theme. To make one page directly: `npm start -- my-page --layout launch --theme studio`.
