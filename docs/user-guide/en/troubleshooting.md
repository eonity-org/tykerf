<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **When something goes wrong**
<!-- /tykerf:header -->

# When something goes wrong

The problems people meet most often, what TYKERF says, and what to do. Most messages name their fix; this page adds the why.

## Starting TYKERF

**`npm start` stops with *… holds other files and no pages, so TYKERF won't start a page or a site there*.**
TYKERF opens a folder as a **page** (it has a `layout.slice`) or a **site** (empty, new, or its subfolders are pages). A folder with other files in it is neither, so TYKERF won't guess. Start it on a new folder, or on the site's folder rather than a folder inside a page.

**It stops with *… holds other folders besides its pages, so it isn't a site*.**
Besides its pages, a site holds only files (its theme, a README) and its own `assets/` and `out/` folders. A folder that also holds other folders, such as your home folder with *Desktop* and *Documents*, isn't a site, even if a page sits in it: open the page itself, or move your pages into a folder of their own (`~/TYKERF`, say).

**The port is already in use.**
Another TYKERF (or another program) is using 4400. Stop it, or start this one with `--port 4500`.

**The page says *TYKERF: unexpected host*.**
The editor only answers at `localhost`, `127.0.0.1` or `[::1]`, so other websites can't reach it through your browser. Open it at `http://localhost:4400`. To reach it from another device on your network, start it with `--host 0.0.0.0` and open it by the computer's IP address; anyone on that network can then edit, so do it only on a network you trust.

**A bar says *TYKERF was updated while this editor was running*.**
The code changed under the running editor (after a `git pull`, for example). Press Ctrl+C in its terminal and run `npm start` again; open pages pick up the new version when you reload them.

## Kaity

**New page says *Kaity is not ready here*.**
The line after it says why:
- *Claude Code is not installed here*: install [Claude Code](https://claude.com/claude-code), run `claude` once and sign in with `/login`, then restart TYKERF. Or use an API key instead ([Which AI answers](ai.md#which-ai-answers)).
- *no key: set TYKERF_API_KEY…* or *set GEMINI_API_KEY…*: the runner in `.env` needs its key. Add it to `.env` and restart TYKERF.

The other ways to start a page (a layout, a copy of a website) work without Kaity.

**Kaity says *Claude Code is not logged in*.**
Run `claude` in a terminal, then `/login`, and ask again. **Test it** under *Kaity status* (the site's *Head code, icon & language* screen) checks it without a real request.

**Kaity stops with an error about the key, the address or the model.**
Use **Test it** under *Kaity status*, on the site's *Head code, icon & language* screen. It sends one short request and shows the answer, so a wrong key, a mistyped `TYKERF_API_BASE_URL` or a model name the service doesn't offer shows up at once. After changing `.env`, restart TYKERF.

**Kaity stopped in the middle of a long request.**
Model services are sometimes slow or busy. When a reply doesn't come in time (180 seconds, `TYKERF_TURN_TIMEOUT`) or the service is busy, TYKERF waits and tries again, up to three times; her steps say so. A request also pauses after 40 steps. In both cases she goes on by herself, up to three times (`TYKERF_CONTINUES`), as long as she is getting somewhere. If she still can't finish, the page or the task says it is **unfinished**: what she did so far stays, and **Continue** lets her go on where she stopped.

**Kaity refuses to change something.**
For a task, she can only change the task's block (and what is inside it). Leave the task on the block you mean, or on `page` (right-click an empty part of the page in the full editor, or a task on the whole page) for something that spans the page. The theme changes only for a task on `page`, and the site's shared head (its head code) is never hers to change.

**Undo and redo say *Kaity is working on …*.**
While Kaity works, undo and redo wait, so they can't undo half of her change. Wait until she is done, or stop her (**Stop Kaity** in the bar).

**Give them to Kaity is greyed out.**
There are no open tasks on the page. Tasks you add while she works join the end of her list. See [Tasks](editor.md#tasks).

**I can't see the numbered pins on the page.**
A pin sits on its element's top-right corner: scroll to the element, or open the tray (the number of tasks in the bar) and choose *Show on the page*. After **Hide tykerf**, nothing of TYKERF shows; **Show tykerf** brings it back.

**A task says its block is gone.**
The block it was left on has been deleted. **Remove** the task and leave a new one where the element is now.

**Kaity can't take screenshots: *screenshots and checks need Chromium*.**
Run `npx playwright install chromium` once. Without it Kaity still edits, but can't look at her work.

**Kaity's text or facts are wrong.**
She writes plausible text when she has none to go on. Give her the real facts in the request, or fix the words yourself by double-clicking them. See [Getting good results from Kaity](asking-kaity.md).

## The Claude plugin

**The TYKERF tools don't appear in Claude Code or Cowork.**
The plugin's server is a Node.js program: install [Node.js](https://nodejs.org) 20 or later, so that `node` works in a terminal, then restart the app. In Cowork, start the task on your computer: a task in the cloud doesn't run plugins' servers, and neither does chat on claude.ai. In Claude Code, `/mcp` shows whether `tykerf` is connected.

**Claude Code says *1 userConfig option not yet set* after installing the plugin.**
Version 0.2.0 asked for a default page folder. Update the plugin (`claude plugin update tykerf@eonity.org`, or *Check for updates* in Cowork): later versions ask for nothing.

**Claude opens `~/TYKERF`, but your pages are elsewhere.**
Name the folder in your request ("in ~/Sites/bakery"), or set `TYKERF_DIR` to it: in your environment, or in a `.env` file in the folder where you start Claude Code. See [the folder Claude works in](claude-plugin.md#the-folder-claude-works-in).

**Claude says *screenshots and checks need Chromium*.**
Run `npx playwright install chromium` once. Everything else works without it.

## Editing

**Links and buttons don't react on the page.**
While the editor is open the page is for pointing at blocks. Press **Back to the page** to use it normally.

**Double-clicking some text opens the Text tab instead of editing it in place.**
TYKERF edits in place only when it can find that exact text in the box's code. Text next to an icon, or text a script writes, is changed in the Text tab instead.

**An image is the wrong size on the page.**
An image's size comes from its box or from the section's layout, not from the image file. Drag the box's handles, or leave Kaity a task on the section. See [Editing in place](editor.md#editing-in-place).

**"A behaviour failed on this page"**

A behaviour of the site kit (a script an element asks for with `data-use`) stopped with an error on this page. The browser's console (right-click → *Inspect* → *Console*) says why and on which element. Open it in the site's **Shared blocks**, under *Behaviours*: an element missing what it expects, often; for a library behaviour that you changed, **Update from the library** puts its version back.

## Copying, exporting and publishing

**The copy of a website looks different from the original.**
A copy is a starting point, not a clone: scripts that depend on the original site don't run, and some styles come out simpler. Fix boxes one by one, by hand or with tasks for Kaity. See [Copying a website](importing.md).

**The export lists files that still load from other servers.**
They are images or fonts a copy couldn't download, or addresses typed by hand. Copy the ones you may use into the page (the image tool's *Copy into the page*) and replace the rest. See [Exporting](exporting.md#what-to-check-before-publishing).

**Publish says *TYKERF needs a GitHub token to publish*, or *GitHub refused the token*.**
Put `TYKERF_GITHUB_TOKEN=…` in `.env` and restart TYKERF. A refused token has expired or was mistyped; make a new one with *Contents: read and write* on that repository. See [Publishing](publishing.md).

**Publish waits.**
It doesn't publish while Kaity is working, so half a change never goes live. Try again when she is done.

## Still stuck?

Search the [issues](https://github.com/eonity-org/tykerf/issues) or open one. Say what you did, what TYKERF said (the exact message), and which runner and model *Kaity status* shows (the site's *Head code, icon & language* screen). Leave out keys and tokens.

<!-- tykerf:footer -->
---

← [TYKERF in Claude Code and Cowork](claude-plugin.md) · [User guide index](README.md)

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
