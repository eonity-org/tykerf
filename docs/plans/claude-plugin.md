<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../README.md) › [Roadmap](../../ROADMAP.md) › **TYKERF in Anthropic's directory: a Claude plugin**
<!-- /tykerf:header -->

# TYKERF in Anthropic's directory: a Claude plugin

Status: **planned, not started** (October 2026). One decision is open (below); nothing is built until it's made.

## Context
TYKERF 0.1.0 ships the Claude Desktop extension (`tykerf.mcpb`, attached to each GitHub release). People can install it by hand, but Anthropic's directory no longer lists desktop extensions: it accepts a local MCP server only inside a **plugin**, submitted from a GitHub repository through the developer portal (claude.ai/directory/manage, *Submit new* → *Plugin bundle*).

A plugin's local MCP server runs in **Claude Code** and in **Cowork sessions on the person's computer**. Chat on claude.ai ignores it. A hosted TYKERF that chat can use is the remote connector of 0.4, a separate submission.

Anthropic's pages this plan follows:
- [Submit your plugin](https://claude.com/docs/plugins/submit)
- [Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)
- [Plugin structure and testing](https://claude.com/docs/plugins/build)
- [Submit a connector](https://claude.com/docs/connectors/building/submission) (tool annotations, privacy policy for local servers)

## Open decision
**How the server finds the page folder.** The extension asks for it on install (`user_config.page_folder` → `--dir`). A plugin's install-time questions (`userConfig`) only work in Claude Code. For Cowork, choose one:
- **Claude asks or creates it:** the server starts without a page, and a tool opens or creates one by path (like `open_page`/`new_page` for a site, with a path instead of a page name). Every other tool refuses until a page is open. This works everywhere, and Claude Code can still pass `--dir` from `userConfig`.
- **A fixed default folder** such as `~/TYKERF`, used as a site: simple, but people don't choose where their pages live.

## Decided
- **Author and contact,** as in TYDAL and FullFrame: copyright "John Pree (eonity.org)" in `NOTICE` and `LICENSE`, the names and logos trademarks of Eonity, and the author shown in listings `{ "name": "Eonity", "url": "https://eonity.org" }` (the extension's manifest says the same). The contact for people is `dev@eonity.org`, also the GitHub organization's email.

## Steps

1. **Tool annotations** (`src/mcp/tools.ts`), useful in every MCP client, so they come first. Every tool gets a `title` and `readOnlyHint: true`, or `destructiveHint` when it can remove something:
   - read-only: `get_layout`, `get_theme`, `list_themes`, `list_layouts`, `list_components`, `get_types`, `resolve`, `estimate`, `get_content`, `list_pages`, `check_page`, `evaluate`, `screenshot`;
   - change the page (`readOnlyHint: false`): the moves, `set_content`, `edit_content`, `add_picture`, `use_component`, `use_theme`, `set_theme`, `rename`, `optimize`, `undo`, `redo`, `render`, `new_page`, `open_page`, `focus`/`unfocus`;
   - also `destructiveHint: true`: the tools that remove blocks or replace a whole page or box (`use_layout`, `use_page`, the removing moves, `set_content`). Every change can be undone, but the hint is about the step itself.
   A test checks that every tool from `createTykerfServer` has a title and a hint, and the extension's manifest keeps listing them.
2. **The page folder**, as the open decision settles it.
3. **The plugin folder** (`plugin/`, built by a script next to `scripts/build-mcpb.ts`, sharing its esbuild step):
   - `.claude-plugin/plugin.json`: `name: "tykerf"`, `displayName: "TYKERF"`, `version` from `package.json` (raised every release), `description`, `author` (see Decided), `license: "Apache-2.0"`, and `userConfig.page_folder` for Claude Code if the open decision keeps it;
   - `.mcp.json`: `node ${CLAUDE_PLUGIN_ROOT}/server/index.js` with plain arguments (no `tsx`, `npm run`, shell or `-c`, which hold the submission for a reviewer);
   - `server/index.js`: the esbuild bundle, **not minified** (the security scan holds code it can't read). It is about 1.5 MB: under the 5 MiB limit, over 256 KiB, so a reviewer reads it;
   - `package.json` + `package-lock.json` with only `playwright`, which Claude Code installs with the plugin, instead of committing Playwright's files (it would pass the 512-file limit);
   - `library/` (layouts, components, themes, fonts), `README.md`, `LICENSE`, and the icon as PNG;
   - no `.DS_Store`, symbolic links or `bin/` folder (a top-level `bin/` stops claude.ai and Cowork from installing a plugin).
   Decide whether `plugin/` is committed on `main` or built into its own branch or repository: the directory reads a folder on a tracked branch or tag, and the plugin should be at the root of what it reads to avoid the "scripts the validator couldn't follow" hold.
4. **A skill** (`plugin/skills/tykerf/SKILL.md`): when to use TYKERF (a request to build or change a web page in a TYKERF folder) and in what order: read the outline with `get_layout`, `focus` the block, change it, `screenshot` at 375 and 1440 px, `check_page` before saying it's done. Short; the tool descriptions already carry the details.
5. **README for the listing** (`plugin/README.md`, at least 40 words outside code):
   - what TYKERF does and how to start (an empty folder or an existing page);
   - **Privacy policy** section: the server reads and writes only the page folder, sends nothing to any server, has no key and calls no API (Claude does the thinking with the person's account); Chromium runs locally for screenshots; nothing is kept outside the folder (its history is in `.history.jsonl` and can be deleted with it); contact `dev@eonity.org`;
   - the one manual step: `npx playwright install chromium` for `screenshot` and `evaluate` (the other tools work without it).
6. **Check and test:**
   - `claude plugin validate ./plugin`;
   - Claude Code: `claude --plugin-dir ./plugin`, then build a page from an empty folder and change one block;
   - Cowork on the computer: zip the folder, *Customize → Plugins → Add → Upload plugin*, and repeat;
   - a test in `test/` like `test/mcpb.test.ts`: the plugin builds, the manifest parses, the server starts and lists its tools.
7. **Submit** from the developer portal (any paid Claude plan; in a Team or Enterprise organization, an Owner):
   - connect the GitHub account that can push to `eonity-org/tykerf`;
   - *Validate*, fix every **Blocking** finding;
   - data handling: reads and stores no personal data, sends nothing to other services, keeps nothing outside the page folder, not aimed at people under 18;
   - set up the GitHub push webhook so new releases reach the directory.
   Expect a reviewer to read the first version: the bundled server, the lockfile install and the large file each hold it, which is normal and not a rejection.
8. **Docs:** a user-guide page or a section in `claude-desktop.md` for the plugin (Claude Code and Cowork), the change in `CHANGELOG.md`, and this plan's status.

## Kept as it is
- `tykerf.mcpb` stays on each release for people who install the extension by hand in Claude Desktop.
- The MCP server's tools don't change for the plugin; only how it's packaged and started.

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
