<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **TYKERF in Claude Desktop**
<!-- /tykerf:header -->

# TYKERF in Claude Desktop

The TYKERF extension lets Claude Desktop change a TYKERF page on your computer, with the same tools Kaity uses in the editor. Claude reads the page as a tree of blocks and changes it through named, validated moves, and every change goes into the page's history.

The extension holds no key and calls no API itself. Claude Desktop does the thinking, with your Claude account. For Claude Code and Cowork, use the plugin instead: [TYKERF in Claude Code and Cowork](claude-plugin.md).

## Install

1. Download `tykerf.mcpb` from the [latest release](https://github.com/eonity-org/tykerf/releases/latest), or build it yourself:

   ```bash
   npm install
   npm run build:mcpb        # makes dist/tykerf.mcpb
   ```

2. Open `tykerf.mcpb`, the download or `dist/tykerf.mcpb` (double-click it, or drag it into Claude Desktop's *Settings → Extensions*), and choose *Install*.
3. When Claude Desktop asks for the **Page folder**, choose one of these:
   - **a site** (a folder of page folders, such as the one the editor makes): Claude lists its pages, opens the one you name and makes new ones ("make a page about Munich next to Rome"), from a layout or as a copy of another page ("like Rome");
   - **a page** (a folder with a `layout.slice`, made with the editor or with `npm run cli -- new my-page launch`): Claude works on it, and on the other pages of its site when it has one;
   - **an empty folder**: ask Claude for a page ("start a page about our bakery from a layout") and it starts one there, or for several pages, and it makes each as a page of a new site.

   After changing the folder in the extension's settings, start a new chat.
4. For screenshots and layout checks, install Chromium once: `npx playwright install chromium`. Without it, every other tool works, and Claude says that pictures need Chromium.

## Use it

Ask in plain words, naming the blocks you mean:

- "Show me the layout of my page."
- "Focus on the hero and make the title shorter, with a button under it."
- "Put the features in two columns, and stack them on phones."
- "Make the accent colour a deep green."

What to expect:

- **Claude looks at its work.** It takes screenshots at desktop and phone widths and fixes what looks wrong.
- **Bigger changes may need your OK.** Every tool tells Claude Desktop whether it only reads the page, changes it, or replaces something whole (a block, a box's code, the whole page), so Claude Desktop, like other clients, may ask you before the bigger changes.
- **Keep the rest of the page safe.** Ask Claude to *focus* on a block: after that, changes outside it are refused. A scope you set yourself (a `.scope` file with `<block> user`, which the editor also uses) can't be lifted by Claude.
- **Everything can be undone.** Ask Claude to undo, or use *Undo* in the editor. The history records each change as made by an AI (`ai`).
- **Use it with the editor.** Keep `npm start -- my-page` open in the browser: Claude's changes appear there as they happen, and you can keep editing. Started on an empty folder, the editor shows its start screen until Claude makes the page, then opens it by itself; pages Claude makes in subfolders are offered on the start screen.

## What it can't do

- It works on one page at a time: the open one. In a site it can list the pages, open another and make new ones, but not rename or remove pages, change the site's shared theme or export. Use the editor for those.
- It can't run commands or touch files outside the page folder. It reads and writes the page only through TYKERF's tools.
- Box scripts are code like any other. Check what Claude writes in a `<script>` before you publish the page (see [SECURITY.md](../../../SECURITY.md)).

<!-- tykerf:footer -->
---

← [Pages and the notation](workspaces.md) · [User guide index](README.md) · [TYKERF in Claude Code and Cowork](claude-plugin.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
