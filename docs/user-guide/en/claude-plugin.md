<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **TYKERF in Claude Code and Cowork**
<!-- /tykerf:header -->

# TYKERF in Claude Code and Cowork

The TYKERF plugin lets Claude Code, and Cowork in the Claude desktop app, build and change TYKERF pages on your computer, with the same tools Kaity uses in the editor. Claude reads a page as a tree of blocks and changes it through named, validated moves, and every change goes into the page's history.

The plugin holds no key and calls no API itself. Claude does the thinking, with your Claude account.

**Which way in:**

| You use | Install |
|---|---|
| Claude Code (terminal, IDE, the desktop app's Code tab) | The plugin (this page) |
| Cowork, when the session runs on your computer | The plugin (this page) |
| Chat in Claude Desktop | The extension: [TYKERF in Claude Desktop](claude-desktop.md) |
| Chat on claude.ai (web, mobile) | Not possible: chat on the web doesn't run programs on your computer |

## What it needs

- **Node.js 20 or later**, with `node` on the PATH: the plugin's server is a Node.js program. (The Claude Desktop extension doesn't need it: Claude Desktop brings its own.)
- **Chromium for screenshots and layout checks**, once: `npx playwright install chromium`. Without it, every other tool works, and Claude says that pictures need Chromium.

## Install

TYKERF's repository is also a plugin marketplace, called **eonity.org**:

- **Claude Code:** run `/plugin marketplace add eonity-org/tykerf`, then `/plugin install tykerf@eonity.org`.
- **Cowork:** in the desktop app, choose *Customize → Plugins → Add marketplace*, enter `eonity-org/tykerf`, then install **TYKERF** from it.

A plugin you add in Cowork or on claude.ai reaches Claude Code too. Each TYKERF release brings a new version, which you get when the plugin updates.

**From the repository**, to try changes before a release:

```bash
npm install
npm run build:plugin        # makes the plugin folder, dist/plugin
```

- **Claude Code**, for one session: `claude --plugin-dir /path/to/tykerf/dist/plugin`.
- **Cowork**: zip the `dist/plugin` folder, then in the desktop app choose *Customize → Plugins → Add → Upload plugin* and select the zip.

## The folder Claude works in

The plugin starts with no folder open. Before it changes anything, Claude opens one and tells you which:

- **The folder you name:** "make a landing page for my bakery in ~/Sites/bakery". A path may start with `~`, your home folder.
- **Otherwise, the default folder:** `TYKERF_DIR`, else `~/TYKERF`. `TYKERF_DIR` comes from the environment or from a `.env` file in the folder where you start Claude Code (`TYKERF_DIR=/Users/you/Sites`), so each project folder can have its own. In Cowork it is `~/TYKERF` unless `TYKERF_DIR` is set in its environment.

What Claude finds there decides what happens:

- **an empty or new folder:** Claude starts a page there from a layout, or a site of pages when you ask for several;
- **a page** (a folder with a `layout.slice`) or **a site** (a folder of pages): Claude opens it as it is, and works on the page you name;
- **a folder that holds other files:** refused, so TYKERF never writes among your own files. Name another folder.

You can switch folders in the same conversation: "now open ~/Sites/rome".

## Use it

Ask in plain words, naming the blocks you mean:

- "Make a page for a yoga studio: classes, prices, a contact form."
- "Focus on the hero and make the title shorter, with a button under it."
- "Put the features in two columns, and stack them on phones."
- "Make the accent colour a deep green."
- "Make the navigation and the footer the same on every page."
- "Go through the tasks I left on the page and do them."

What to expect:

- **Claude looks at its work.** It takes screenshots at desktop and phone widths and fixes what looks wrong.
- **Keep the rest of the page safe.** Ask Claude to *focus* on a block: after that, changes outside it are refused.
- **Bigger changes come with a question.** Before replacing a whole page with a layout or another page, Claude asks. Every tool also tells Claude Code whether it only reads the page, changes it, or replaces something whole, so Claude Code may ask you to allow a change.
- **Tasks you left in the editor.** In the editor's **Tasks** mode you leave tasks on the page's elements ([Tasks](editor.md#tasks)); ask Claude to work through them and it reads each at the width it was written at, does it and closes it with a short reply.
- **Everything can be undone.** Ask Claude to undo, or use *Undo* in the editor. The history records each change as made by an AI (`ai`).
- **See it in the browser.** Ask Claude to render the page: it writes `out/index.html` and tells you where. Or keep the editor open on the same folder (`npm start -- ~/TYKERF` from the repository): Claude's changes appear there as they happen.

## What it can't do

- It works on one page at a time: the open one. In a site it can list the pages, open another, make new ones, rename them (links follow) and remove them (to the site's trash), and work with the [site kit](sites.md#the-site-kit): a shared navigation and footer, and the styles and behaviours every page uses. It can't change the site's shared theme or export; use the editor for those.
- It changes pages only through TYKERF's tools. The plugin tells Claude never to edit a page's files directly, which would skip the checks and the history.
- Box scripts are code like any other. Check what Claude writes in a `<script>` before you publish the page (see [SECURITY.md](../../../SECURITY.md)).

<!-- tykerf:footer -->
---

← [TYKERF in Claude Desktop](claude-desktop.md) · [User guide index](README.md) · [When something goes wrong](troubleshooting.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
