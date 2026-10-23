<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **When something goes wrong**
<!-- /tykerf:header -->

# When something goes wrong

The problems people meet most often, what TYKERF says, and what to do. Most messages name their fix; this page adds the why.

## Starting TYKERF

**`npm start` stops with *… holds other files and no pages, so TYKERF won't start a page or a site there*.**
TYKERF opens a folder as a **page** (it has a `layout.slice`) or a **site** (empty, new, or its subfolders are pages). A folder with other files in it is neither, so TYKERF won't guess. Start it on a new folder, or on the site's folder rather than a folder inside a page.

**The port is already in use.**
Another TYKERF (or another program) is using 4400. Stop it, or start this one with `--port 4500`.

**The page says *TYKERF: unexpected host*.**
The editor only answers at `localhost`, `127.0.0.1` or `[::1]`, so other websites can't reach it through your browser. Open it at `http://localhost:4400`. To reach it from another device on your network, start it with `--host 0.0.0.0` and open it by the computer's IP address; anyone on that network can then edit, so do it only on a network you trust.

**A bar says *TYKERF was updated while this editor was running*.**
The code changed under the running editor (after a `git pull`, for example). Press Ctrl+C in its terminal and run `npm start` again; open pages pick up the new version when you reload them.

## Kaity

**The start screen says *Kaity is not ready here*.**
The line after it says why:
- *Claude Code is not installed here*: install [Claude Code](https://claude.com/claude-code), run `claude` once and sign in with `/login`, then restart TYKERF. Or use an API key instead ([Which AI answers](ai.md#which-ai-answers)).
- *no key: set TYKERF_API_KEY…* or *set GEMINI_API_KEY…*: the runner in `.env` needs its key. Add it to `.env` and restart TYKERF.

The other ways to start a page (a layout, a copy of a website) work without Kaity.

**Kaity says *Claude Code is not logged in*.**
Run `claude` in a terminal, then `/login`, and ask again. **Site → Kaity status… → Test** checks it without a real request.

**Kaity stops with an error about the key, the address or the model.**
Use **Site → Kaity status… → Test**. It sends one short request and shows the answer, so a wrong key, a mistyped `TYKERF_API_BASE_URL` or a model name the service doesn't offer shows up at once. After changing `.env`, restart TYKERF.

**Kaity stopped in the middle of a long request.**
The API runners stop a request after 40 steps, and a single model turn after 180 seconds (`TYKERF_TURN_TIMEOUT` changes that). What she did so far stays. Ask her to go on in the same conversation.

**Kaity refuses to change something.**
She can only change the selected block. Select the block you mean (or `page`) and ask there. The theme can be changed only with `page` selected, and the site's shared head (Styles & scripts) is never hers to change.

**Undo and redo say *Kaity is working on …*.**
While Kaity works, undo and redo wait, so they can't undo half of her change. Wait until she is done, or stop her (*Stop* in the Kaity tab, or the **×** of the build window).

**Kaity can't take screenshots: *screenshots and checks need Chromium*.**
Run `npx playwright install chromium` once. Without it Kaity still edits, but can't look at her work.

**Kaity's text or facts are wrong.**
She writes plausible text when she has none to go on. Give her the real facts in the request, or fix the words yourself by double-clicking them. See [Getting good results from Kaity](asking-kaity.md).

## Editing

**Links and buttons don't react on the page.**
While the editor is open the page is for pointing at blocks. Press **Back to the page** to use it normally.

**Double-clicking some text opens the Text tab instead of editing it in place.**
TYKERF edits in place only when it can find that exact text in the box's code. Text next to an icon, or text a script writes, is changed in the Text tab instead.

**An image is the wrong size on the page.**
An image's size comes from its box or from the section's layout, not from the image file. Drag the box's handles, or ask Kaity about the section. See [Editing in place](editor.md#editing-in-place).

## Copying, exporting and publishing

**The copy of a website looks different from the original.**
A copy is a starting point, not a clone: scripts that depend on the original site don't run, and some styles come out simpler. Fix boxes one by one, by hand or with Kaity. See [Copying a website](importing.md).

**The export lists files that still load from other servers.**
They are images or fonts a copy couldn't download, or addresses typed by hand. Copy the ones you may use into the page (the image tool's *Copy into the page*) and replace the rest. See [Exporting](exporting.md#what-to-check-before-publishing).

**Publish says *TYKERF needs a GitHub token to publish*, or *GitHub refused the token*.**
Put `TYKERF_GITHUB_TOKEN=…` in `.env` and restart TYKERF. A refused token has expired or was mistyped; make a new one with *Contents: read and write* on that repository. See [Publishing](publishing.md).

**Publish waits.**
It doesn't publish while Kaity is working, so half a change never goes live. Try again when she is done.

## Still stuck?

Search the [issues](https://github.com/eonity-org/tykerf/issues) or open one. Say what you did, what TYKERF said (the exact message), and which runner and model **Site → Kaity status…** shows. Leave out keys and tokens.

<!-- tykerf:footer -->
---

← [TYKERF in Claude Code and Cowork](claude-plugin.md) · [User guide index](README.md)

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
