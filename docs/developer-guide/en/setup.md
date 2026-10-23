<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **Setup and tests**
<!-- /tykerf:header -->

# Setup and tests

## Requirements

- Node.js 22 or later. TYKERF runs TypeScript directly through `tsx`, so there is no build step except for the Claude Desktop extension.
- Chromium for Playwright: `npx playwright install chromium`. It is used by screenshots, the page checks, the importer and the browser tests.
- Optional: [Claude Code](https://claude.com/claude-code), for the default AI runner.

```bash
git clone https://github.com/eonity-org/tykerf.git
cd tykerf
npm install
npx playwright install chromium
npm test && npm run typecheck
```

## Run it

```bash
npm start -- examples/widgets                 # one page, at http://localhost:4400
npm start -- /tmp/my-site --port 4500         # a new or empty folder is a site: the start screen
npm run mcp -- --dir examples/widgets         # the MCP server on stdio
npm run cli -- layouts                      # the command line (outline, render, export, import, new, …)
```

The editor edits the folder in place, so try changes on a copy, or on a new folder, rather than on `examples/`.

AI settings come from `.env` (copy `.env.example`): `TYKERF_RUNNER`, `TYKERF_MODEL` and the keys. Without it, the AI tab runs your Claude Code.

## Tests

`npm test` runs everything with Vitest; `npm run typecheck` runs `tsc --noEmit` (TypeScript 7). One file or one test:

```bash
npx vitest run test/moves.test.ts
npx vitest run test/site.test.ts -t "like another"
```

| Kind | Files | What they check |
|---|---|---|
| The core | `notation`, `moves` (with a property test of 1000 random move sequences), `refs`, `render`, `shape`, `boxes`, `types-scope`, `redo`, `store`, `concurrency` | The tree, its notation, moves, rendering, the optimizer, box types and scope, history, locks across processes |
| Sites and pages | `site`, `layouts`, `theme`, `assets`, `export`, `import-files` | Sites, shared theme, page renames and links, layouts and presets, images, export and zip |
| AI and MCP | `mcp-scope`, `runners`, `mcpb` | MCP tools under a scope, the API runners against fake API servers, the bundled Claude Desktop server |
| In a browser | `editor`, `site-editor`, `start-ai`, `inline`, `import`, `design` | The editor end to end, the start screen, the AI-first start (fake API), editing in place, the importer on a local fixture site, design checks |

**`test/design.test.ts`** renders every page layout in the main theme presets at 1440 and 375 px and fails on:
- text below WCAG AA contrast against its own band;
- more than one `h1`, or a skipped heading level;
- sideways scroll on a phone.

Run it after changing a component, a layout or a preset.

Browser tests start real editor processes on random ports and use Playwright. They ignore your `.env` (`vitest.config.ts` sets `TYKERF_DOTENV=off`), so your own AI settings don't change what they check. Running them in parallel with everything else is heavy; a timing-sensitive test can fail once in a while under load. Run it alone before you treat it as a real failure.

## Project layout

```
src/
  model.ts notation.ts moves.ts refs.ts   the tree, its text form, validated moves, references
  render.ts shape.ts types.ts scope.ts    tree → HTML, shape functions + optimizer, box types, AI scope
  store.ts workspace.ts                   where files live, a page (box code, head, history, undo)
  site.ts library.ts assets.ts          sites (shared theme, renames, links), library/themes/fonts, images
  export.ts zip.ts                        static export and a small zip writer
  importer.ts import-files.ts             website → page (XY-cut), and the copy's images and fonts
  metrics.ts screenshot.ts                page checks, screenshots
  cli.ts
  mcp/tools.ts mcp/server.ts              the MCP tools (a factory) and the stdio server
  editor/server.ts editor/page.ts         the editor's HTTP server and one page's API
  editor/ai.ts editor/runners/ editor/tools-client.ts   AI conversations and the model runners
  editor/public/                          the browser client: plain JS, no build (tykerf.js, chooser.js, inline.js, start.html)
library/                                layouts.json, components/, theme.html, themes.json, fonts/, assets/
scripts/                                  build-mcpb.ts (Claude Desktop extension), brand-png.ts
test/                                     Vitest suites (see above)
docs/                                     user guide, developer guide, notation spec, plans
examples/widgets/                         a sample page the tests read
```

## Rules every change follows

The short version (the full list is in [CONTRIBUTING.md](../../../CONTRIBUTING.md)):

- **The tree is never invalid.** Moves are pure (`clone → mutate → finish`) and either return a valid layout or throw.
- **Everything goes through `Workspace`** (`save`, `setContent`, `setHead`, `rename`, `group`), never through writing page files directly. Otherwise a change isn't validated, typed, scope-checked or undoable.
- **Read-modify-write goes in `ws.transaction()`.** It is the lock that keeps the editor and the AI's MCP process from overwriting each other.
- **The AI says row/column**, never H/V.
- **The editor client has no build step.** Every UI string goes through `t()` as a whole sentence, and all UI lives in a shadow root.
- **No third-party requests.** Fonts and images are bundled or copied into the page; nothing loads from a CDN.
- **Keep [the notation spec](../../slicing-notation.md) in sync** with the grammar and the moves.
- **Update the docs in the same change.** [Writing the docs](documentation.md) says which page covers what.

## Working with an AI coding assistant

TYKERF is built with AI coding assistants as well as by hand, and the repository is set up for them:

- **`CLAUDE.md`** is the assistant's map of the code: every module, the rules other code relies on, and the traps. Claude Code reads it at the start of every session; other assistants can be pointed at it. When a change moves a responsibility, adds a rule or a module, or retires one, update `CLAUDE.md` in the same change, in its own terse style. A stale line there misleads every later session.
- **Ask for the same checks a person runs:** `npm test` and `npm run typecheck`, and `test/design.test.ts` after touching a component, a layout or a preset. Review the diff as you would a colleague's: the rules above apply to generated code too.
- **Give it a running editor to look at.** An assistant that can start `npm start -- /tmp/some-site` and drive it with Playwright (Chromium is already needed for the tests) can check a UI change on the real page instead of guessing.
- **Kaity is a separate thing.** The AI inside the editor works on pages through MCP tools and can't touch the code; an assistant working *on* TYKERF changes the code itself. Don't give Kaity's prompt or tools rules meant for developers, or the other way round.

<!-- tykerf:footer -->
---

← [Developer guide](README.md) · [Developer guide index](README.md) · [Architecture](architecture.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
