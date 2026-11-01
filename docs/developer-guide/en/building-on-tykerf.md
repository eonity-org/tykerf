<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **Building on TYKERF**
<!-- /tykerf:header -->

# Building on TYKERF

The rest of this guide is about changing TYKERF. This page is about **using** it from your own code: making pages in a script, letting your own agent edit pages through the MCP tools, and checking a site in CI. Every example on this page was run against the code as it is.

TYKERF isn't published to npm yet. Clone it and run your code with `tsx` from inside the clone, importing from `src/` (the examples live in `scripts/` and import `../src/…`). TypeScript runs directly; there is nothing to build.

```bash
git clone https://github.com/eonity-org/tykerf.git && cd tykerf && npm install
npx tsx scripts/make-page.ts /tmp/visit-lisbon
```

## Which way in

| You want to… | Use | Why |
|---|---|---|
| Make or change pages from a script, a generator or a test | **The library** (`Workspace`, moves, `library.ts`) | The same functions the editor runs, with validation, box types and history |
| Let a model or agent change pages | **The MCP server**, over stdio or in-process | Scope, refusals and history come with it; the model never touches files |
| Make, render or export pages from a shell or a CI job | **The command line** (`npm run cli`) | No code to write |
| Check a site before it goes live | **Export and metrics** from a short script | The report and the scores as data, and an exit code |

Whatever the way in, keep to the rule the editor follows: **change pages through `Workspace` (or the tools built on it), never by writing their files.** Files written by hand skip validation, box types, scope and history; the editor and Kaity may then see a page that a move could never have made.

## Make a page in a script

```ts
// scripts/make-page.ts: npx tsx scripts/make-page.ts /tmp/visit-lisbon
import { Workspace } from '../src/workspace.js';
import * as M from '../src/moves.js';
import { createPage, useComponent } from '../src/library.js';
import { outline } from '../src/notation.js';
import { leftovers, say } from '../src/check.js';

const ws = new Workspace(process.argv[2]);      // the page's folder; made on the first write
createPage(ws, 'blank', 'studio');              // a layout and a theme, as the start screen does

// two changes, one undo step
ws.group('add a FAQ', 'script', () => {
  ws.save(M.insertNext(ws.load(), 'text', 'H', 'faq'), 'add faq below text', 'script');
  useComponent(ws, 'faq', 'faq', 'script');
});
ws.setContent('faq', ws.content('faq')!.replace('Questions, answered', 'Before you visit'), 'script');

console.log(outline(ws.load()));
console.log(leftovers(ws).slice(0, 3).map(say).join('\n'));
console.log(ws.history(3));
```

What it shows:
- **`createPage(ws, layout, theme)`** writes a page from a library layout (`npm run cli -- layouts` lists them). Without a theme name it uses `clean`, the theme's bare values; people get `studio`.
- **Moves are pure.** `M.insertNext(layout, id, 'H' | 'V', name)` returns a new layout or throws a `MoveError`; nothing is written until `ws.save(layout, label, author)`. The code uses `H` and `V`; only the AI's vocabulary says *column* and *row*.
- **The last argument is the author.** Anything you pass ends up in `.history.jsonl` (the editor writes `user`, the MCP server `ai`), so a script's changes are easy to tell apart and the editor's ⌘Z undoes them like any other.
- **`ws.group(label, author, fn)`** turns several changes into one undo step; if `fn` throws, what it already did is undone.
- **`leftovers(ws)`** lists what is unfinished (sample text, placeholder pictures, links without a target), the same list Kaity is checked against.

Open the folder with `npm start -- /tmp/visit-lisbon` and the page, its history and its undo are all there.

**Writing the tree yourself.** When you already have the structure, give the notation and the box code to `create`:

```ts
import { Workspace } from '../src/workspace.js';

const ws = new Workspace(process.argv[2]);
ws.create('nav hero[role=main] facts V{2:1} footer[#tone-dark] H3@page', {
  nav: '<nav><a href="/">Lisbon</a></nav>',
  hero: '<h1>Seven hills, one tram</h1>',
  facts: '<ul><li>Tram 28 since 1914</li></ul>',
  footer: '<p>Made for curious travellers</p>',
});
console.log(ws.render());   // writes out/index.html and returns its path
```

`create` refuses a folder that already has a page, and writes no head: add a theme with `ws.setHead(…)`, or start from `createPage` and change the tree. The notation is specified in [docs/slicing-notation.md](../../slicing-notation.md).

**Pages of a site** are made with `newSitePage(siteDir, name, layout, theme)` (`site.ts`), which also gives the page the site's shared theme. To open an existing page of a site, use `pageWorkspace(siteDir, name)`, or `new Workspace(pageDir, { site: siteOf(pageDir) })`: a plain `new Workspace(pageDir)` renders without the site's head.

## Let your own agent edit pages (MCP)

TYKERF's tools are an MCP server, so any agent that speaks MCP can use them, with the scope and refusals that keep Kaity inside one block. The tools are listed in [the AI and MCP](ai-and-mcp.md#the-mcp-tools-srcmcptoolsts).

**Over stdio**, as Claude Desktop and Claude Code run it:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'node_modules/.bin/tsx',
  args: ['src/mcp/server.ts', '--dir', process.argv[2]],
}));
const text = (r: any) => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');

console.log(text(await client.callTool({ name: 'get_layout', arguments: {} })));
await client.callTool({ name: 'focus', arguments: { ref: 'faq' } });     // from here on, only faq may change
const r = await client.callTool({ name: 'edit_content', arguments: { id: 'faq', old: 'Before you visit', new: 'Good to know' } });
console.log(r.isError ? 'refused' : 'ok', text(r));
const out = await client.callTool({ name: 'set_content', arguments: { id: 'nav', html: '<p>hi</p>' } });
console.log(out.isError ? 'refused' : 'ok', text(out));               // refused: outside the scope
await client.callTool({ name: 'unfocus', arguments: {} });
await client.close();
```

- **A refusal is a tool error, not an exception**: `isError` is set and the text starts with `refused:` and says why. Pass it back to your model as the tool's result; models handle it well ("ask the user to widen the scope").
- **`focus` writes the page's `.scope` file**, so it lasts until `unfocus`, across processes and restarts. Start the server with `--scope <block>` instead for a limit that lasts only as long as the process, as the editor does for each Kaity run. A scope a person set (`<block> user` in `.scope`) can't be lifted by the model at all.
- **`--dir` may be a site.** The server then also offers `list_pages`, `open_page` and `new_page`; with `--scope` it doesn't.
- **`--lazy` starts with no folder open.** Every tool but `open_folder` and the library lists refuses until the agent calls `open_folder`, with a path or without one for the default folder (`--dir`, else `TYKERF_DIR`, else `~/TYKERF`). The Claude plugin starts the server this way; see [the AI and MCP](ai-and-mcp.md#the-claude-plugin).

**In-process**, for tests or an agent that runs in your own Node program:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTykerfServer } from '../src/mcp/tools.js';
import { closeScreenshots } from '../src/screenshot.js';
import { Workspace } from '../src/workspace.js';

const ws = new Workspace(process.argv[2]);
const server = createTykerfServer(ws, { scope: 'faq' });   // this server's limit, like an editor run
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'my-tests', version: '1.0.0' });
await Promise.all([server.connect(a), client.connect(b)]);

const { tools } = await client.listTools();                 // name, description, JSON Schema: hand them to your model
console.log(tools.length, 'tools');
const r: any = await client.callTool({ name: 'screenshot', arguments: { id: 'faq', width: 375 } });
console.log(r.content.map((c: any) => c.type));             // [ 'image', 'text' ]
await client.close();
await closeScreenshots();                                   // the screenshot tool keeps one browser open
```

- **Close the browser.** `screenshot` and `evaluate` start Chromium once and keep it for the next call; without `closeScreenshots()` your process won't exit.
- **The loop around the model** (send the conversation and the tools, run what the model calls, send the results back, stop at the answer) is in `src/editor/runners/loop.ts`, with the Anthropic and Gemini message formats in `anthropic.ts` and `gemini.ts`. It is the best starting point for an agent of your own: it already handles screenshots as images, a step limit, cut-off replies and cancelling.
- **Tell the model the vocabulary.** The tools speak of *rows* and *columns*; Kaity's system prompt (`CODE_RULES` in `editor/ai.ts`) is a tested set of rules for writing box code (theme variables, band tones, components, checking at 1440 and 375 px). Reuse what fits.

## From a shell or a CI job

```bash
npm run cli -- new my-site launch --theme studio    # a new site with its home page from a layout (on a site: one more page)
npm run cli -- import https://example.com my-copy   # a copy of a website (Chromium), as the home page of a new site
npm run cli -- render my-site                       # a page, or every page of a site into its own out/
npm run cli -- export my-site dist/                 # plain files for any host (--files: links that open from disk)
npm run metrics -- dist/home/index.html --widths 375,1440   # layout scores as JSON
```

`new` makes a page with a theme of its own. A page meant to share a site's theme is made with `newSitePage` (above), or with *New page…* in the editor.

The CLI and `metrics` exit with 0 even when the report lists problems: they report, they don't judge. For a check that fails a build, read the reports from a script:

```ts
// scripts/check-site.ts: npx tsx scripts/check-site.ts <site-or-page> <out-dir>
import { exportToFolder } from '../src/export.js';
import { evaluateFile } from '../src/metrics.js';
import { closeScreenshots } from '../src/screenshot.js';

const [site, out] = process.argv.slice(2);
const report = exportToFolder(site, out);
const problems = [
  ...report.broken.map((b) => `broken link: ${JSON.stringify(b)}`),
  ...report.remote.map((r) => `loads from another server: ${JSON.stringify(r)}`),
];
for (const page of report.pages) {
  const file = page === 'index' ? `${out}/index.html` : `${out}/${page}/index.html`;
  const m = await evaluateFile(file, { widths: [375, 1440] });
  if (m.breakage) problems.push(`${page}: ${m.breakage} layout problem(s) at 375 or 1440 px`);
}
await closeScreenshots();
console.log(problems.join('\n') || 'all clear');
process.exitCode = problems.length ? 1 : 0;
```

- **`report.broken`** lists links to pages that aren't in the site; **`report.remote`** lists images, fonts, stylesheets and scripts still loaded from other servers.
- **`breakage`** counts hard failures at each width: sideways scroll, overflowing elements, distorted images and missing priority blocks. The full report also has line-length issues, small tap targets and wasted space, which are worth reading but rarely worth failing a build for.
- A CI runner needs Chromium for the metrics: `npx playwright install --with-deps chromium`.

To publish from CI as well, `publishToGitHub` (`src/publish.ts`) is what the site manager's **Publish** calls, with the token in `TYKERF_GITHUB_TOKEN`; see [DEPLOY.md](../../../DEPLOY.md).

## What is stable

TYKERF is young, and only some of it is meant to be built on. Lean on these, which the tests pin down and the docs describe:

- **The notation and the `.slice` format** ([the spec](../../slicing-notation.md)).
- **The MCP tools**: their names, arguments and refusals. They are what models are prompted with, so they change carefully.
- **`Workspace`**'s public methods, the moves in `moves.ts`, `createPage`, `useComponent`, `newSitePage`, `exportToFolder`, `leftovers`.
- **The page folder's layout** (`layout.slice`, `boxes/`, `head.html`, `assets/`, `.history.jsonl`).

Anything else (the editor's HTTP endpoints, the editor's client, the runners' internals, the files under `.tykerf/`) may change in any release. If you need something there, open an issue saying what you're building.

<!-- tykerf:footer -->
---

← [Extending TYKERF](extending.md) · [Developer guide index](README.md) · [Writing the docs](documentation.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
