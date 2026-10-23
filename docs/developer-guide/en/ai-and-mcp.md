<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **The AI and MCP**
<!-- /tykerf:header -->

# The AI and MCP

TYKERF never lets a model rewrite a page. A model gets TYKERF's **MCP tools**: validated moves on the tree, plus reading and writing box code, all limited to one block. Every AI path goes through the same tools:
- the editor's AI tab;
- Claude Desktop;
- any MCP client.

**Naming.** People meet the editor's AI as **Kaity**, eonity's assistant in TYKERF (Tydal's is Aity). Its symbol is eonity's three-ball isotype, which pulses while Kaity works (`kaityMark()` in tykerf.js, with the same geometry and colours as Tydal's `TydalIsotype`; see [BRAND.md](../../../BRAND.md#kaity)). Every string people see says *Kaity*, and the system prompt tells the model its name. Code and these docs keep the technical names: AI, runner, MCP.

## The MCP tools (`src/mcp/tools.ts`)

`createTykerfServer(ws, { scope })` builds an `McpServer` with every tool, working on one `Workspace`:
- **`src/mcp/server.ts`** is only its stdio entry: `--dir <page>` and `--scope <block>`. A page of a site also gets the site's shared head.
- **The editor's API runners** use the same factory in-process (`editor/tools-client.ts`).

| Group | Tools |
|---|---|
| Read | `get_layout` (the outline; only the scope block when there is one), `resolve`, `get_content`, `get_types`, `get_theme`, `list_themes`, `list_layouts`, `list_components`, `estimate` |
| Scope | `focus`, `unfocus` |
| Pages | `list_pages`, `open_page`, `new_page` (from a layout, or `copy` of another page); only with `home` and no scope: see below |
| Folders | `open_folder` (a page, a site, or an empty or new folder; the default one without a path); only with `folders`, the Claude plugin's `--lazy` start: see below |
| Tree | `split`, `wrap`, `unwrap`, `flip`, `swap`, `move`, `add_leaf`, `remove`, `set_ratios`, `set_op`, `set_leaf`, `set_variant`, `tag`, `untag`, `add_rule`, `remove_rule`, `attach_overlay`, `detach_overlay`, `rename`, `normalize`, `optimize` |
| Code and look | `use_page` (this page with another page's blocks, code and images: `usePage` in `site.ts`), `set_content` (a box's whole code), `edit_content` (replace one exact piece of it: quick on long code, such as a copied site's; both warn when the code uses a file the page doesn't have, `missingFiles` in `check.ts`), `add_picture` (an SVG the model draws, or a picture the user attached, into `assets/`: models can't download pictures), `use_component`, `set_theme`, `use_theme` (a preset), `use_layout` (replaces the whole page with a page layout; page root in scope) |
| History | `undo`, `redo` |
| Look and check | `check_page` (what the scope block has left unfinished: `src/check.ts`), `screenshot` (a PNG of a block with a dashed frame, or of the page, at a width), `evaluate` (sideways scroll, overflow, line length, tap targets… at several widths), `render` |

How every tool behaves:
- **References.** Node arguments are resolved through `resolveRef` (name, path or position), so the history logs real names.
- **Moves** (`moveTool`) run `load → move → commit` inside `ws.transaction()`. `commit` refuses the change when `scopeViolation` finds anything outside the scope changed. The reply lists only the outline lines that changed.
- **Annotations.** Each tool has a title for people and hints for clients: read-only, a change, or a change that replaces something whole (`use_layout`, `use_page`, `use_component`, `use_theme`, `set_content`, `remove`, `unwrap`, `normalize`, removing a rule or an overlay). `screenshot` and `evaluate` are read-only but marked as reaching the open world: Chromium renders the page, and its code may load files from other servers.
- **Screenshots and checks see the page's files.** `openPage` (`src/screenshot.ts`) opens the page at a stand-in address, `http://tykerf.page`, and answers every request there from `pageFiles(ws)`, as the editor serves them: a lone page at `/` with its `assets/`; a page of a site at `/page/`, below the site's own files at `/assets/` (`SiteLink.asset`). Its pictures and fonts load, so a screenshot shows them and `evaluate` measures them. A picture over 2000 px tall is cut; the reply says which part it shows (`0–2000 px of 9071`) and the `from` that shows the rest, so a long page or block is seen in pieces. A page opened on `about:blank` resolves none of them; other servers' addresses still go to the network.
- **Links to a section** use the block's own element, `#sw-<name>`: the instructions say so, and `check_page` names it when a link uses the bare name (`#faq`).
- **Errors** come back as tool errors with the layout unchanged.
- **Vocabulary.** The model only ever sees *row*, *column*, *wheel* and *periphery* (`KIND_WORD`), never H/V: a model once read `H` as "horizontal row".
- **The theme.** `set_theme` changes existing theme variables only, each value checked by kind, and only when the scope is the whole page. It refuses a theme shared by the whole site, because one page's AI may not restyle every page.
- **Undo and redo** under a scope refuse steps that would change something outside it.

### The scope

The AI may only change its scope block and what is inside it (`src/scope.ts`):
- **Editor runs:** the scope is the selected block, passed as `--scope` (or `{ scope }`) for that run only. It follows the block if the AI renames it.
- **Other MCP clients:** `focus` sets the workspace's `.scope` file. A scope set by the user (`<block> user`) can't be lifted or widened by the model.
- **A deleted block:** if a user scope's block is gone, every tool refuses. The limit is never silently lifted.

## The editor's AI (`src/editor/ai.ts`)

The `AI` class keeps, per block:
- **Conversations:** `.tykerf/chats/<block>.json`, with attached pictures in `.tykerf/images/`.
- **One run at a time per page.** While it runs, a guard on the editor's `Workspace` locks the block: the person can keep editing the rest of the page, but not that block, and undo and redo wait. If the AI renames the block, the conversation, the lock and the selection follow it (`followRenames`).
- **The system prompt:** what the block is, the scope rule and the code rules (`CODE_RULES`: box code is a fragment; use the theme's variables, band tones and components; check at 1440 and 375 px). A page built from the start screen adds `BUILD_BRIEF` (`editor/server.ts`).

### What a request leaves unfinished (`src/check.ts`)

`leftovers(ws, { within })` lists what a block still has to be finished:
- **Sample text:** every text piece of two words or more from `library/components/` (single words such as *Privacy* can stay), less the interface words in `KEEP` (*Read more*, *See all →*…) and plain figures.
- **Placeholder pictures:** `assets/placeholder-*.svg` and `assets/mockup-*.svg`.
- **Links without a target:** `#` or empty; `#id` with no such id on the rendered page (a block's own element is `#sw-<name>`); `/page/` when the site has no such page (`SiteLink.pageNames`).

`AI.ask` keeps the page's leftovers when a request starts (`leftoverKey`) and compares at the end, so only what that request added is reported, less what the person kept (`.tykerf/kept.json`):
- **A whole page** (a `brief`, as from the start screen, or a `use layout` step in the request) gets one more pass in the same run: `fixPrompt(left)` goes to the model, and the chat shows a `check` message with `state: 'auto'`. The block lock, the job and *Stop* cover both passes.
- **Otherwise** the chat ends with a `check` message with `state: 'open'`: `POST /_tykerf/check/fix` asks Kaity with the list (`state: 'fixing'`), and `POST /_tykerf/check/leave` keeps the items (`state: 'left'`).

### Kaity for the whole site

`server.ts` keeps one more `AI`, over a `Workspace` on the site folder with `{ site: dir }`: one conversation (`SITE_CHAT`, in the site's `.tykerf/chats/`), `siteSystem()` instructions, no block lock and no leftovers check. Its runs carry `home` (`RunRequest.home`), so Claude Code starts the MCP server on the site without `--scope`, and the API runners open the tools with `home` (`openTools`): `list_pages`, `open_page` and `new_page` are there, and every other tool works on the open page. Endpoints: `GET /_tykerf/site/chat`, `GET /_tykerf/site/events` (SSE), `POST /_tykerf/site/ask`, `…/ask/cancel`, `…/chat/reset`. A page run and the site run wait for each other (409), and renames and removals wait for the site run.

### Runners

A `Runner` runs the model for one request:

```ts
interface Runner {
  readonly name?: string; readonly model?: string;
  start(req: RunRequest, on: RunEvents): { cancel(): void };
  status?(): { ready: boolean; note: string };   // installed / key set, without calling the model
  check?(): Promise<string>;                     // one tiny real request (the "Test" button)
}
```

`RunRequest` carries:
- the `Workspace`, the page folder, the scope and the system prompt;
- the prompt and the pictures;
- the Claude Code session to resume, and `memory` (load and save) for runners that keep the conversation themselves.

`RunEvents` reports `session`, `step` (one line per tool call, or `refused: …`), `answer`, `error` and `end`.

`TYKERF_RUNNER` picks one (`runners/index.ts`):

| Runner | How it works |
|---|---|
| `claude-code` (default) | Spawns `claude -p --input-format stream-json --output-format stream-json --tools "" --strict-mcp-config --mcp-config <tykerf server --dir … --scope …> --allowedTools mcp__tykerf --permission-mode dontAsk`. The model has only TYKERF's tools; the conversation resumes Claude Code's own session. It inherits the environment, so a proxy set with `ANTHROPIC_BASE_URL` applies |
| `anthropic` | The Messages API through `@anthropic-ai/sdk`, with `TYKERF_API_KEY` or `TYKERF_AUTH_TOKEN` and `TYKERF_API_BASE_URL` (falling back to `ANTHROPIC_*`), so any Anthropic-compatible endpoint works |
| `gemini` | `@google/genai` with `GEMINI_API_KEY` (and `GEMINI_BASE_URL`); tools as `functionDeclarations` with `parametersJsonSchema` |

**The API runners share `runners/loop.ts`:**
- **The loop:** it opens the tools in-process (`openTools`, an MCP client over `InMemoryTransport`) and sends the conversation and the tools. It runs each tool the model calls, sends the results back (screenshots as pictures), and stops at the model's answer or after 40 steps. One model turn may take `TURN_TIMEOUT` (3 minutes; `TYKERF_TURN_TIMEOUT` in seconds): a request the API never answers then ends the run with a message instead of leaving it running.
- **A separate `Workspace` object.** The tools work on their own `Workspace` (same store, same site), so the editor's lock on the block doesn't refuse the AI's own changes. The store's lock still keeps each change whole.
- **Memory** is kept per block in `.tykerf/chats/<block>.api.json` as *exchanges* (a request and everything after it). Pictures are replaced by a note once an exchange is over, and the oldest exchanges go past about 100,000 characters.
- **The provider part.** Each provider only implements the `Wire` part: one model turn, a user message, tool results, a message without pictures, and readable errors (refused key, rate limit, unknown model, network).
- **Cut-off replies.** A reply cut off at the output limit (`max_tokens` / `MAX_TOKENS`) runs none of its tool calls, and the loop tells the model why (`CUT`).

**Claude Code specifics:**
- `ClaudeCodeRunner.warm()` finds out in the background whether `claude` is installed. Never call the CLI synchronously from a request.
- Every `claude` it starts gets `claudeEnv()`: the environment without `CMUX_*`, because a cmux terminal's wrapper would otherwise take Kaity's runs as its own sessions.
- The selected block is the run's scope (`--scope` to the MCP server; the workspace `.scope` file is not touched). Pictures go in the stream-json user message and are kept in `.tykerf/images/`. `TYKERF_MODEL` picks the model.

### The AI-first start

`POST /_tykerf/site/new` with `prompt`, `images` and/or `zip` (`{name, data}`, a design export):
1. checks `runner.status()`;
2. reads the ZIP, if any (`readDesignZip` in `src/editor/design-zip.ts`, on the dependency-free reader `src/unzip.ts`: safe names, size caps checked while inflating, CRC): its pictures join `images` (five in all), its text files become the run's `context` (`designContext`), and the chat shows only `designNote`; a ZIP with nothing usable is refused before any page is made;
3. makes an empty page (`EMPTY_LAYOUT`: `header` and `main` with empty code, so nothing shows until Kaity builds it);
4. starts `ai.ask(root, prompt, undefined, images, BUILD_BRIEF, context)` (`context` goes to the model after the prompt, not into the chat);
5. answers with the root's name.

The chooser's `openMadePage` then opens the page with the panel on, on the root's AI tab, through `sessionStorage['tykerf.resume']`.

## The Claude Desktop extension

`npm run build:mcpb` (`scripts/build-mcpb.ts`):
- bundles `src/mcp/server.ts` with esbuild into `dist/mcpb/server/index.js`;
- copies `library/` beside it (library.ts finds `../layouts`), and `playwright` and `playwright-core` into `server/node_modules`;
- writes a manifest (v0.3, with `user_config.page_folder` → `--dir`, and the tool list taken from `createTykerfServer`);
- validates and packs `dist/tykerf.mcpb`.

**The page folder** is trimmed (a path pasted into the setting often brings a space). It may be empty or not exist yet: every tool then answers how to start, and `use_layout` (with an optional `theme`) creates the page there through `createPage`. A run with a `--scope` can't.

**A site.** `server.ts` passes the folder as `home`. When `home` is a site, an empty folder or a page of a site, the page tools work on the open page: `open_page` and `new_page` (`newSitePage`) replace the server's `Workspace`, and `list_pages` marks the open one. Started on a site, no page is open until `open_page`. `use_layout` refuses to start a page right in a folder that holds pages. A run with a scope (the editor's Kaity) isn't offered them; it gets the site's other page names in its instructions instead (`AI.otherPages`), for `use_page`.

**No folder yet (the Claude plugin).** `server.ts --lazy` starts `createTykerfServer(null, { folders: { defaultDir } })`: Cowork can't ask for a folder on install, so none is open, and every tool but `open_folder` and the library lists (`FOLDERLESS`) answers "no folder is open" (one wrapper around `server.registerTool` checks it). `open_folder` takes a path (`folderPath`: `~` is the home folder, spaces trimmed) or opens the default: `--dir` when given, else `TYKERF_DIR` (the environment, or a `.env` in the folder the server starts in), else `~/TYKERF`. It checks the folder with `siteKind`, then replaces `ws` and `home`, so the page tools above work there; a folder of other files is refused and the open one stays. It writes nothing: `use_layout` or `new_page` make the folder when they first write. Only the plugin gets it: the extension and `claude mcp add --dir` open their folder at once and keep to it, and the editor's runs never get `folders`.

## The Claude plugin

Anthropic's directory lists a local MCP server only inside a plugin, which runs in Claude Code and in Cowork on the person's computer. `npm run build:plugin` (`scripts/build-plugin.ts`) writes the plugin folder to `dist/plugin/`:
- the same server bundle as the extension (`bundleServer` in `build-mcpb.ts`: readable, not minified, since the directory's scan holds code it can't read) and `library/`;
- `.claude-plugin/plugin.json`: name, version from `package.json`, author `eonity.org`, the directory's listing fields (`icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`), and no setting: Claude Code flags an empty one as not set and Cowork never asks, so the default folder is `TYKERF_DIR`, else `~/TYKERF`, in both;
- `.mcp.json`: `node ${CLAUDE_PLUGIN_ROOT}/server/index.js --lazy` (see *No folder yet* above);
- Playwright in `node_modules/`, trimmed to what screenshots need (`SHIPPED`: `playwright`'s entry files, and `playwright-core` without its browser-install scripts, trace viewer and recorder apps, command-line tools and skills, WebP encoder, `xdg-open` and type declarations; the licenses stay), and a `package.json` with no dependencies and no lockfile. Cowork runs what a plugin ships but doesn't install its packages, so Playwright has to be inside; Claude Code then installs nothing either and uses the same files;
- `README.md` (the listing, with the privacy policy) and `skills/tykerf/SKILL.md` from `plugin/`, plus `LICENSE`, `NOTICE` and the icon. The skill tells Claude when to use TYKERF (a page or a small site without a codebase, not an application's pages) and in what order: open the folder and say which, read or start the page, focus, change, look at 1440 and 375 px, `check_page`; and to change pages only through the tools, never with file tools, which Claude Code also has. It loads in chat too, where it says TYKERF needs Claude Code or Cowork.

The directory follows the `claude-plugin` branch, which holds the built folder at its root: the release workflow commits it there for each published release, next to the extension. The repository is also a marketplace, **eonity.org**: `.claude-plugin/marketplace.json` on the default branch lists `tykerf` with a `github` source at `ref: claude-plugin`, so people install it before and besides the directory (`/plugin marketplace add eonity-org/tykerf`, or *Add marketplace* in Cowork). The entry sets no `version`: `plugin.json`'s, raised with every release, decides when people get an update. `test/plugin.test.ts` checks that every tool the skill names exists, the directory's file rules (under 512 files, nothing over 5 MiB, only the server and Playwright's two bundles over 256 KiB, only text, pictures and fonts, no symbolic links or `bin/`), the trimmed Playwright, and that the bundled server starts with no folder open, edits the one it opens and takes a screenshot. `claude plugin validate dist/plugin` runs Claude Code's own checks. To try it, `claude --plugin-dir dist/plugin`, or zip `dist/plugin` and upload it in the desktop app (*Customize → Plugins*) for Cowork.

Code the server imports must have no module-level side effects. Playwright is imported lazily (`launchChromium`), so the server works without Chromium. `test/mcpb.test.ts` builds the bundle and drives it over stdio from another folder.

## Testing AI code without a model

- **`test/runners.test.ts`:**
  - starts a fake Anthropic API and a fake Gemini API that answer with scripted turns, so the real tools, scope and history run;
  - covers keys, cancel, the step cap, screenshots and memory.
- **`test/start-ai.test.ts`:** runs the whole AI-first start in a browser against the fake API.
- **`test/concurrency.test.ts`:** uses a fake `Runner` to test the block lock and rename-following.

<!-- tykerf:footer -->
---

← [The editor](editor.md) · [Developer guide index](README.md) · [Extending TYKERF](extending.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
