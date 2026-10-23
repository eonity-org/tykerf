---
name: tykerf
description: Build or change a web page or a small website of plain HTML pages with TYKERF, block by block. Use when the person asks for a landing page, a page for a business, an event or a project, or a few linked pages, without a codebase; when they work on a TYKERF page or site (a folder with layout.slice, or a folder of such pages); or when they mention TYKERF. Not for pages inside an application's codebase (React, Vue, a framework project): edit those as code.
---

# Building pages with TYKERF

TYKERF's tools edit a page as a tree of named blocks (rows, columns, and boxes of HTML). Every change is validated and goes into the page's history, so it can be undone.

If the TYKERF tools aren't available here (chat on claude.ai doesn't run them), say that TYKERF works in Claude Code and in Cowork on the person's computer, and don't build the page some other way.

## Change pages only through the tools

Never edit `layout.slice`, `boxes/` or `head.html` with file tools or shell commands: those changes skip the checks and the undo history, and can leave the page broken. If something can't be done with the tools, say so.

## The steps

1. **Open a folder.** If the person named one, `open_folder` with that path. Otherwise `open_folder` without a path, and tell them which folder opened (the default), so they can name another before anything is written. A folder that holds other files is refused: ask for another.
2. **Start or read the page.**
   - An empty folder: for one page, pick a layout and a theme (`list_layouts`, `list_themes`) and `use_layout`; for several pages, `new_page` for each.
   - An existing page: `get_layout` first. In a site, `list_pages` and `open_page`.
3. **Focus before you change.** When the request is about one block ("the header", "the pricing"), `focus` on it, so nothing outside it can change. `unfocus` when you move on to another part.
4. **Change it.**
   - A new section: start from a component (`list_components`, `use_component`), then rewrite its text and pictures for this page.
   - Part of a box's code: `edit_content`, not the whole box.
   - Colours, fonts and spacing for the whole page: `set_theme` or `use_theme`.
   - Narrow screens: `add_rule` (flip a row into a column, hide a box), not a different base layout.
   - Pictures: draw an SVG or place one the person attached with `add_picture`. You can't download pictures; never make up a file name.
5. **Ask before replacing a page.** `use_layout` and `use_page` replace a whole existing page. Undo brings it back, but say what will happen and ask first.
6. **Look at it.** `screenshot` at 1440 and 375 px wide, and fix what looks wrong: spacing, alignment, contrast, text that spills out.
7. **Finish.** `check_page` lists placeholder text and pictures left from layouts and components, and links that go nowhere: fix them, or tell the person what is still needed from them.

## When you answer

Say which folder and page you changed and what changed, in a few lines. Mention that every change can be undone ("undo the last change"). To see the page in a browser, `render` writes `out/index.html` and replies with its path.
