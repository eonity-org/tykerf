<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../README.md) › [Roadmap](../../ROADMAP.md) › **TYKERF in Anthropic's directory: a Claude plugin**
<!-- /tykerf:header -->

# TYKERF in Anthropic's directory: a Claude plugin

Status: **planned, not started** (October 2026). The decisions are made (below); one detail is checked while building (where Cowork starts the server).

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
- **Author and contact,** as in TYDAL and FullFrame: copyright "John Pree (eonity.org)" in `NOTICE` and `LICENSE`, the names and logos trademarks of Eonity, and the author shown in listings `{ "name": "Eonity", "url": "https://eonity.org" }` (the extension's manifest says the same). The contact for people is `dev@eonity.org`, also the GitHub organization's email.
- **The account that submits:** a claude.ai account on `dev@eonity.org`, Eonity's, used for TYKERF only. The listing belongs to the account it's submitted from, so this one can go with the domain if Eonity becomes a company, and personal chats stay apart. It needs a paid plan (Pro is enough), and the form's contact email is `dev@eonity.org` too. Plugin listings show the repository (`eonity-org/tykerf`) and `plugin.json`, not the account; check the portal's **Listing details** preview before submitting.

## Steps

1. **Tool annotations** (`src/mcp/tools.ts`), useful in every MCP client, so they come first. Every tool gets a `title` and `readOnlyHint: true`, or `destructiveHint` when it can remove something:
   - read-only: `get_layout`, `get_theme`, `list_themes`, `list_layouts`, `list_components`, `get_types`, `resolve`, `estimate`, `get_content`, `list_pages`, `check_page`, `evaluate`, `screenshot`;
   - change the page (`readOnlyHint: false`): the moves, `set_content`, `edit_content`, `add_picture`, `use_component`, `use_theme`, `set_theme`, `rename`, `optimize`, `undo`, `redo`, `render`, `new_page`, `open_page`, `focus`/`unfocus`;
   - also `destructiveHint: true`: the tools that remove blocks or replace a whole page or box (`use_layout`, `use_page`, the removing moves, `set_content`). Every change can be undone, but the hint is about the step itself.
   A test checks that every tool from `createTykerfServer` has a title and a hint, and the extension's manifest keeps listing them.
2. **The page folder** (see Decided), in `src/mcp/server.ts` and `src/mcp/tools.ts`:
   - a "no folder" state in `createTykerfServer` (every tool reads `ws` when it runs, so `open_folder` reassigns it as `open_page` does);
   - `open_folder` reuses `siteKind` and the site's empty-folder start; it refuses a path that is neither a page, a site nor empty, and is refused under a run scope like the other page tools;
   - the plugin starts the server with a flag that means "don't open yet" (for example `--lazy`), so the extension and `claude mcp add` keep opening `--dir` at once;
   - check where Claude Code and Cowork start the server (its working folder and environment): that decides whether a `.env` there can set `TYKERF_DIR`, or whether most Cowork users get `~/TYKERF`;
   - tests: no folder → tools refuse; `open_folder()` → the default; an empty path → a new site; a non-TYKERF folder → refused; switching folders.
3. **The plugin folder** (`plugin/`, built by a script next to `scripts/build-mcpb.ts`, sharing its esbuild step):
   - `.claude-plugin/plugin.json`: `name: "tykerf"`, `displayName: "TYKERF"`, `version` from `package.json` (raised every release), `description`, `author` (see Decided), `license: "Apache-2.0"`, and an optional `userConfig.page_folder` (the default folder, for Claude Code);
   - `.mcp.json`: `node ${CLAUDE_PLUGIN_ROOT}/server/index.js` with plain arguments (no `tsx`, `npm run`, shell or `-c`, which hold the submission for a reviewer);
   - `server/index.js`: the esbuild bundle, **not minified** (the security scan holds code it can't read). It is about 1.5 MB: under the 5 MiB limit, over 256 KiB, so a reviewer reads it;
   - `package.json` + `package-lock.json` with only `playwright`, which Claude Code installs with the plugin, instead of committing Playwright's files (it would pass the 512-file limit);
   - `library/` (layouts, components, themes, fonts), `README.md`, `LICENSE`, and the icon as PNG;
   - no `.DS_Store`, symbolic links or `bin/` folder (a top-level `bin/` stops claude.ai and Cowork from installing a plugin).
   Decide whether `plugin/` is committed on `main` or built into its own branch or repository: the directory reads a folder on a tracked branch or tag, and the plugin should be at the root of what it reads to avoid the "scripts the validator couldn't follow" hold.
4. **A skill** (`plugin/skills/tykerf/SKILL.md`): when to use TYKERF (a request to build or change a web page in a TYKERF folder) and in what order: read the outline with `get_layout`, `focus` the block, change it, `screenshot` at 375 and 1440 px, `check_page` before saying it's done. Short; the tool descriptions already carry the details.
5. **README for the listing** (`plugin/README.md`, at least 40 words outside code):
   - what TYKERF does and how to start (Claude opens `~/TYKERF` or the folder you name; an empty folder becomes a new site);
   - **Privacy policy** section: the server reads and writes only the page folder, sends nothing to any server, has no key and calls no API (Claude does the thinking with the person's account); Chromium runs locally for screenshots; nothing is kept outside the folder (its history is in `.history.jsonl` and can be deleted with it); contact `dev@eonity.org`;
   - the one manual step: `npx playwright install chromium` for `screenshot` and `evaluate` (the other tools work without it).
6. **Check and test:**
   - `claude plugin validate ./plugin`;
   - Claude Code: `claude --plugin-dir ./plugin`, then build a page from an empty folder and change one block;
   - Cowork on the computer: zip the folder, *Customize → Plugins → Add → Upload plugin*, and repeat;
   - a test in `test/` like `test/mcpb.test.ts`: the plugin builds, the manifest parses, the server starts and lists its tools.
7. **Submit** from the developer portal, signed in as `dev@eonity.org` (see Decided):
   - connect, in that claude.ai account, the GitHub account that can push to `eonity-org/tykerf`;
   - *Validate*, fix every **Blocking** finding;
   - data handling: reads and stores no personal data, sends nothing to other services, keeps nothing outside the page folder, not aimed at people under 18;
   - set up the GitHub push webhook so new releases reach the directory.
   Expect a reviewer to read the first version: the bundled server, the lockfile install and the large file each hold it, which is normal and not a rejection.
8. **Docs:** a user-guide page or a section in `claude-desktop.md` for the plugin (Claude Code and Cowork), the change in `CHANGELOG.md`, and this plan's status.

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
