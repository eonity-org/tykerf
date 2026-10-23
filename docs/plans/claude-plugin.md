<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../README.md) › [Roadmap](../../ROADMAP.md) › **TYKERF in Anthropic's directory: a Claude plugin**
<!-- /tykerf:header -->

# TYKERF in Anthropic's directory: a Claude plugin

Status: **planned, not started** (October 2026). The decisions are made (below); one detail is checked while building (how Cowork starts the server).

## Context
TYKERF 0.1.0 ships the Claude Desktop extension (`tykerf.mcpb`, attached to each GitHub release). People can install it by hand, but Anthropic's directory no longer lists desktop extensions: it accepts a local MCP server only inside a **plugin**, submitted from a GitHub repository through the developer portal (claude.ai/directory/manage, *Submit new* → *Plugin bundle*).

A plugin's local MCP server runs in **Claude Code** and in **Cowork sessions on the person's computer**. Chat on claude.ai ignores it. A hosted TYKERF that chat can use is the remote connector of 0.4, a separate submission.

Anthropic's pages this plan follows:
- [Submit your plugin](https://claude.com/docs/plugins/submit)
- [Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)
- [Plugin structure and testing](https://claude.com/docs/plugins/build)
- [Submit a connector](https://claude.com/docs/connectors/building/submission) (tool annotations, privacy policy for local servers)

## Decided
- **The page folder: Claude opens or creates it, with a default.** The extension asks for the folder on install (`user_config.page_folder` → `--dir`), but a plugin's install-time questions (`userConfig`) only work in Claude Code, so the plugin's server starts with **no folder open**:
  - a new tool, `open_folder(path?)`, opens a page or a site at a path, and creates an empty site there when the folder is empty or new; every other tool answers "open a folder first" until one is open, and `open_folder` can switch to another folder later in the conversation;
  - without a path it opens **the default folder**: `--dir` (Claude Code's `userConfig.page_folder`), else `TYKERF_DIR` (the environment, or a `.env` loaded the way the editor loads it, `TYKERF_DOTENV=off` skipping it), else **`~/TYKERF`** by construction;
  - Claude says which folder it opens, so the person can name another before anything is written;
  - the stdio server keeps today's behavior for existing setups: with `--dir` (the extension, `claude mcp add … --dir`) that folder is open from the start.
- **Author and contact,** as in TYDAL and FullFrame: copyright "John Pree (eonity.org)" in `NOTICE` and `LICENSE`, the names and logos trademarks of Eonity, and the author shown in listings `{ "name": "eonity.org", "url": "https://eonity.org" }` (the extension's manifest says the same): the domain, not a bare "Eonity", because the GitHub name `Eonity` belongs to someone else (hence `eonity-org`) and the directory holds a publisher name that may be confused with another. "Eonity" stays the brand in `NOTICE` and "an eonity project". The contact for people is `dev@eonity.org`, also the GitHub organization's email.
- **The account that submits:** a claude.ai account on `dev@eonity.org`, Eonity's, used for TYKERF only. The listing belongs to the account it's submitted from, so this one can go with the domain if Eonity becomes a company, and personal chats stay apart. It needs a paid plan (Pro is enough), and the form's contact email is `dev@eonity.org` too. Plugin listings show the repository (`eonity-org/tykerf`) and `plugin.json`, not the account; check the portal's **Listing details** preview before submitting.

## Steps

1. **Tool annotations** (`src/mcp/tools.ts`): **done.** Every tool has a `title` and one of four sets of hints (`READ`, `CHANGE`, `REPLACE`, `LOOK`); `test/mcp-tools.test.ts` checks every tool has them. Replaces: `use_layout`, `use_page`, `use_component`, `use_theme`, `set_content`, `remove`, `unwrap`, `normalize`, `remove_rule`, `detach_overlay`. Read-only also covers `open_page` (it writes nothing); `screenshot` and `evaluate` are read-only with `openWorldHint`, since the page Chromium renders may load files from other servers.
2. **The page folder** (see Decided): **done.** `server.ts --lazy` starts with no folder open; `open_folder(path?)` opens a page, a site or an empty or new folder (the default without a path: `--dir`, else `TYKERF_DIR` from the environment or the starting folder's `.env`, else `~/TYKERF`), writes nothing itself, refuses a folder of other files and keeps the open one. Every other tool but the library lists answers "no folder is open". Only the plugin gets it (`folders` option). Tests: `test/mcp-folder.test.ts`. Still to check with the plugin: where Claude Code and Cowork start the server, which decides whether a `.env` there can set `TYKERF_DIR`.
3. **The plugin folder:** **done.** `scripts/build-plugin.ts` (`npm run build:plugin`) writes `dist/plugin/` from the extension's bundle (`bundleServer`), `library/`, and the sources in `plugin/`; `plugin.json` has the listing fields and `page_folder` with an empty default (Cowork drops a server whose setting has no default); Playwright comes from a lockfile taken from the repository's. **Where it lives:** the `claude-plugin` branch, the built folder at its root, committed by the release workflow for each published release; the directory follows that branch. `claude plugin validate` passes. Found while building: the plugin needs **Node.js on the computer** (`node` on the PATH), unlike the extension, which uses Claude Desktop's; the README says so.
4. **A skill** (`plugin/skills/tykerf/SKILL.md`): **done.** Its description keeps it to pages and small sites without a codebase (not an application's pages, which Claude Code edits as code). The steps: open the folder and say which (the default when none is named), read or start the page, `focus`, change (components, `edit_content`, the theme, `add_rule`, `add_picture`), ask before `use_layout`/`use_page` replace a page, `screenshot` at 1440 and 375 px, `check_page`. It forbids editing the page's files with file tools, and in chat (no tools) it says TYKERF needs Claude Code or Cowork. `test/plugin.test.ts` checks every tool it names exists.
5. **README for the listing** (`plugin/README.md`): **drafted with step 3** (the build needs it): what TYKERF does and how it differs, how to start, what it needs (Claude Code or local Cowork, Node.js 20+, Chromium for screenshots), and the **Privacy policy** section, which `privacyPolicyUrl` links to on `main`. Review its wording before submitting.
6. **Check and test:** **Claude Code: done** (a page from one sentence in `~/tykerf-plugin-test`: skill, `open_folder` with the default from `TYKERF_DIR`, layout, components, drawn pictures, `check_page`, `evaluate`, `render`). It found two bugs, both fixed: screenshots and `evaluate` didn't load the page's files (pictures broken, fonts as Georgia, for every client, not only the plugin), and links written `#news` instead of `#sw-news`. The skill now names the folder before anything is written and reads one box at a time. A second run confirmed the fixes (folder named first, pictures and fonts in screenshots, `#sw-` links from the start); it still read every box at once, so `get_content`'s description now steers to one box. **The `.env` question: yes**, Claude Code starts the server in the folder where it was launched, and a `.env` there sets `TYKERF_DIR` (the user guide says so). **Still to try: Cowork** (does the server start with the desktop app's PATH, and does it install Playwright).
7. **Submit** from the developer portal, signed in as `dev@eonity.org` (see Decided):
   - connect, in that claude.ai account, the GitHub account that can push to `eonity-org/tykerf`;
   - *Validate*, fix every **Blocking** finding;
   - data handling: reads and stores no personal data, sends nothing to other services, keeps nothing outside the page folder, not aimed at people under 18;
   - set up the GitHub push webhook so new releases reach the directory.
   Expect a reviewer to read the first version: the bundled server, the lockfile install and the large file each hold it, which is normal and not a rejection.
8. **Docs:** **done.** `docs/user-guide/en/claude-plugin.md` (*TYKERF in Claude Code and Cowork*): which way in for which app, what it needs (Node.js, Chromium), installing (by hand until the directory lists it), the folder Claude opens and the default, what to expect and what it can't do. `open_folder` is now in the tools table of `ai.md`; `claude-desktop.md`, `ai.md` and the README point to the page. Update the install section once the directory lists TYKERF.

## Before submitting
Open, and it doesn't block steps 1–6 (`NOTICE` stays as it is, the same as in TYDAL and FullFrame):
- **Registering the names** (TYKERF, and maybe TYDAL and Eonity) before the listing makes them visible: the plugin's `name` is permanent, and an unregistered name is weak protection against someone registering it first.

## Kept as it is
- `tykerf.mcpb` stays on each release for people who install the extension by hand in Claude Desktop.
- The MCP server's tools don't change for the plugin; only how it's packaged and started.

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
