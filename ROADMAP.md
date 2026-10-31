<!-- tykerf:header -->
&nbsp;

[<img src="src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](README.md) › **TYKERF roadmap**
<!-- /tykerf:header -->

# TYKERF roadmap

TYKERF lets people and AI agents edit web pages through validated moves on a slicing tree. The current experience is documented in [README.md](README.md) and [the user guide](docs/user-guide/README.md).

---

Implemented (0.1): slicing notation v0.2 with validated moves, references, box types and AI scope; workspaces with per-box code, shared history and undo; the editor over the real page (tree panel, text/code/size tabs, Delete vs Remove with a paste buffer, one AI conversation per block with images and screenshots); the MCP server with `evaluate` and `screenshot`; the CLI with renderer, optimizer and website importer; bundled fonts and no third-party requests; an editor interface ready for translation.

---

## Decisions

- **The intelligence is in TYKERF; Tydal only stores pages.** Tydal is the system of record for page files and who may see them. Everything that understands pages (the tree, moves, rendering, the AI, the importer) stays in TYKERF.
- **AI, locally:** the user's own Claude Code, as today; Claude Code and Cowork through the TYKERF plugin; and Claude Desktop through a one-click extension. TYKERF holds no credentials.
- **AI, in the cloud:** a hosted TYKERF server uses its own API key from its environment (`.env`). TYKERF, not the user's account, runs and pays for those requests.
- **Copying any website is allowed,** with clear advice: the copy usually contains someone else's text, images and design, so publish it only with the owner's permission.
- **TYKERF on Tydal follows the FullFrame pattern:** TYKERF is its own server, talks to Tydal through `@tydal/client`, keeps Vault keys encrypted on the server, and serves published pages itself.
- **Languages:** English first. The interface already goes through `t()`; Spanish comes after a few iterations.

## 0.2: foundations and the local experience

The last part of 0.2 followed [docs/plans/0.2-finish.md](docs/plans/0.2-finish.md): page names and links, the exporter, the API runners (Anthropic-compatible and Gemini) and the Claude Desktop extension.

- **Storage interface (done).** `Workspace`, box types, the editor (buffer, new pages), the AI runner (chats, images) and the importer read and write through a synchronous `Store` (`src/store.ts`): `FolderStore` and `MemoryStore` today. The Tydal store (0.3) keeps a local snapshot of each page and syncs it with Tydal outside those calls; the AI's MCP child process still needs a folder until MCP over HTTP lands.
- **AI runner interface (done).** One interface for the editor's AI tab, chosen with `TYKERF_RUNNER`: Claude Code (default), the Anthropic API or any Anthropic-compatible endpoint, and Gemini. The API runners run TYKERF's MCP tools in-process: same tools, same scope, same history. Checked against the real Gemini API (`gemini-pro-latest`) and an Anthropic-compatible endpoint (Z.ai, `glm-5.1`): edits, screenshots, scope, memory, undo and stop. Still to do: the Anthropic API itself, with a real key.
- **MCP over HTTP.** Streamable HTTP transport next to stdio, behind a bearer key, so the MCP server can run as a service.
- **Claude Desktop extension (done).** `npm run build:mcpb` bundles the MCP server into `dist/tykerf.mcpb`, which asks for the page folder on install; `screenshot` and `evaluate` work where Chromium is installed. Each published GitHub release gets `tykerf.mcpb` attached (`.github/workflows/release.yml`).
- **A Claude plugin (done; Anthropic's directory next).** For Claude Code and Cowork on the computer: the MCP server with a skill and the part of Playwright screenshots need, installed from TYKERF's own marketplace (`/plugin marketplace add eonity-org/tykerf`). Each release publishes it to the `claude-plugin` branch. Next: submitting it to Anthropic's directory, which no longer lists desktop extensions. Plan: [docs/plans/claude-plugin.md](docs/plans/claude-plugin.md).
- **Layouts and components (done).** Ten page layouts, seven theme presets and 41 components on a shared theme; the Page tab for the theme and head code; an `assets/` folder per page. The AI lists and uses components through MCP (`list_components`, `use_component`). Editing in place: text (words, bold, italic, links) and images (replace, crop, turn, scale down, saved as new files in `assets/`).
- **Page names, links and export (done).** Rename and remove pages (links between pages follow a rename), a link picker with the site's pages, and exporting a page or a site as plain files or a zip.
- **Importer in the editor (done).** "Start from a website" on a new page and "Import a section" into a box (the page's sections with a picture of each; the chosen one replaces the box in one undo step, its styles in a marked block of the head), both showing the copying advice. Tested on 10 real sites and the worst failures fixed first. A copy brings the site's images and fonts into its `assets/`, so it loads nothing from the original servers.
- **Tasks and the handbook (done).** People leave tasks on any element of the page (with the window width), as numbered tabs that follow it; Kaity works through them and closes them, one block or the whole page at once, and any MCP client can too (`list_tasks`, `close_task`). The handbook shows the page's theme and every block, with chips to copy into a request and its tasks, as a page and as Markdown. Two new components: *Steps on a line* and *Hero with a switcher*. Plan: [docs/plans/tasks-and-handbook.md](docs/plans/tasks-and-handbook.md).
- **The site kit (done).** What every page of a site shares besides the theme, in its `kit/` folder: styles, behaviours (`data-use`), shared blocks (one navigation and footer for every page, with *Make this page's own copy*), box types and the site's own tags; in the site manager, the editor, exports and Kaity's site run. Plan: [docs/plans/site-sharing.md](docs/plans/site-sharing.md).
- **Unused files (done).** The Page tab offers to move files no box, head or undo step uses to `.trash/`, and exports leave them out.

## 0.3: TYKERF on Tydal

Needs from the Tydal team: a `tykerf-page` schema (a resource bundling `layout.slice`, `boxes/`, `types/`, `head.html` and the history) and setup commands like FullFrame's (`tykerf:setup` per organization, `tykerf:create` per site).

- **Tydal store** through `@tydal/client`: a site is a Vault, each page a resource; a shared Vault URL is resolved once into a hash, as FullFrame does.
- **Sign-in with a Tydal account;** Vault read/write keys encrypted on the server (`TYKERF_ENCRYPTION_KEY`), never sent to the browser.
- **Publish and unpublish through the Vault lifecycle:** render, then *activate* and *open* (Tydal's anonymous access); *close* makes it private again and deletes nothing. Write keys need `w:ingest`, `w:update`, `w:withdraw`, `w:activate`, `w:open`, `w:close`.
- **TYKERF serves the published pages** (`/{organization}/{site}/{page}`). Images come from Tydal renditions through TYKERF's proxy, so pages make no third-party requests.
- **Deployment like FullFrame:** Docker and `docker-compose.yml`, `.env.example` (`TYDAL_URL`, `TYKERF_ENCRYPTION_KEY`, admin password), and the matching sections in `DEPLOY.md`.

## 0.4: hosted MCP and cloud AI

- **The MCP server as a service** on the Tydal-attached TYKERF, scoped by Vault keys, in line with Tydal's Vault MCP.
- **Sign-in for MCP clients (OAuth),** so TYKERF can be added as a remote connector in claude.ai.
- **The AI tab on the server** uses the API runner with TYKERF's key from the environment, with usage limits per organization and per page.
- **Screenshots on the server,** with Chromium installed once in the image.

## 0.5: Chrome extension

- **A thin client (Manifest V3)** that injects the TYKERF panel into the current tab; the AI and the keys stay on the TYKERF server.
- **On TYKERF or Tydal pages:** edit them in place.
- **On any other site:** "Copy this page" runs the XY-cut in the live tab (it sees exactly what the user sees, including signed-in content) and saves the copy to a local or Tydal-hosted TYKERF, with the copying advice.
- **Connects to a local TYKERF** (the server accepts the extension's own origin and nothing else) **or a Tydal-hosted TYKERF** (signed in).

## Later

- Spanish: `src/editor/public/i18n/es.json`, the user guide in `docs/user-guide/es/`, and server messages.
- Sites (done locally: a folder of pages, the start screen, New page…). Page renames with links that follow, a link picker and exporting a page or a site as plain files are done ([plan](docs/plans/0.2-finish.md)). Next: the site as a Tydal Vault (0.3). A shared site theme and *New page like this one* are done; the rest of the site manager (sections, shared media, a navigation menu) is [not scheduled yet](docs/plans/site-manager.md); when it comes, it opens from the editor's Site menu.
- Drag blocks to rearrange them; wheel layouts in the editor.
- The AI places a picture attached in the AI tab into a box (saved to `assets/`).
- Listing in the MCP Registry once the Desktop extension or an npm package exists.
- The change language (section 8 of the notation spec): reviewable, replayable change sets.

<!-- tykerf:footer -->
---

[TYKERF](README.md) · [Documentation](docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
