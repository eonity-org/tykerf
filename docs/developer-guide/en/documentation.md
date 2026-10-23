<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **Writing the docs**
<!-- /tykerf:header -->

# Writing the docs

TYKERF's docs are part of the product: a feature isn't done until the page that explains it is right. This page says where each kind of text goes, how the pages are written, and what checks them.

## What goes where

| File or folder | Reader | What it holds |
|---|---|---|
| `README.md` | Everyone, first | What TYKERF is, the video, a quick start, links to the rest |
| `docs/user-guide/<lang>/` | People who make pages and sites | How to use TYKERF, task by task. No code internals |
| `docs/developer-guide/<lang>/` | People who change or extend TYKERF | How it works and how to add to it |
| `docs/slicing-notation.md` | Both | The formal grammar of the notation; the contract the code follows |
| `DEPLOY.md` | People who run TYKERF for others | Servers, publishing, sign-in, MCP clients |
| `SECURITY.md` | Everyone | What TYKERF trusts and what it doesn't, how to report a problem |
| `CONTRIBUTING.md` | Contributors | Ground rules, translations, pull requests |
| `ROADMAP.md`, `docs/plans/` | Contributors | What comes next, and the design of larger pieces before they are built |
| `BRAND.md` | Anyone writing UI or docs | The name, the mark, the colours, Kaity's symbol and name |
| `CLAUDE.md` | AI coding assistants (and people who want a dense map) | Every module, its rules and its traps, in as few words as possible |
| `docs/user-guide/images/` | | Screenshots used by the guides |
| `docs/media/` | | The demo video and its poster |

## Which page to update

When a change alters what people see or how the code is extended, update the guide in the same pull request:

| You changed… | Update |
|---|---|
| Something in the panel, a tab, a menu, a shortcut | `user-guide/en/editor.md` |
| The start screen, *New page…*, the ways to start | `getting-started.md`, `sites.md`, and the chooser section of `developer-guide/en/editor.md` |
| What Kaity can do, a runner, an environment variable | `user-guide/en/ai.md` (and `.env.example`), `developer-guide/en/ai-and-mcp.md` |
| An MCP tool | The tools table in `user-guide/en/ai.md`, `developer-guide/en/ai-and-mcp.md` |
| A message people may see when something fails | `user-guide/en/troubleshooting.md`, if people are likely to meet it |
| A layout, a component or a theme preset | `user-guide/en/layouts.md` (the tables list every offered one) |
| The site manager, links, the site's head | `user-guide/en/sites.md` |
| Export or publish | `exporting.md`, `publishing.md`, `DEPLOY.md` |
| The notation, a move, a reference form | `docs/slicing-notation.md` |
| A module's job, a rule other code relies on | `developer-guide/en/architecture.md` and `CLAUDE.md` |
| The path a change takes (an endpoint, `Workspace.save`, the scope check, the events) | `developer-guide/en/following-a-change.md` |
| A function or tool people build on (`Workspace`, moves, `createPage`, export, the MCP tools' arguments) | `developer-guide/en/building-on-tykerf.md`: its examples must still run |

## How the pages are written

The guides share one voice. Read a page or two before writing a new one; these are the rules they follow:

- **Write for the reader's task**, not for the code. A user page answers "how do I…?"; its headings are things people do.
- **Plain, short sentences, in the present tense.** Say what happens: "Undo goes back one step", not "Undo will allow you to revert".
- **Name the interface exactly as it shows**, from the `t()` strings: buttons and tabs in bold (**Publish**, the **Kaity** tab), menu entries and choices in italics (*Export the site…*, *This page only*). Keep the ellipsis when the UI has one.
- **Kaity is "she"**, as in the interface ("Kaity checks the things she left unfinished"). The model behind her is named separately (Claude Code, the Anthropic API, Gemini).
- **Rows and columns**, never H and V, in the user guide. The letters belong to the notation, the developer guide and the spec.
- **Concrete examples.** A request in quotes ("make the hero shorter"), a real folder name, a real command. Prefer the examples already used across the guides (the bakery in Murcia, Rome, Lisbon) so pages read as one story.
- **Say what doesn't work.** Limits go in the page that describes the feature (the *Not yet* section of `editor.md`, *What it can't do* in `claude-desktop.md`), not in a separate list.
- **Tables for choices, lists for steps.** A table when the reader picks one of several; a numbered list when they do things in order.
- **No marketing words.** Not "seamless", "powerful" or "simply". If something is quick, say how quick.
- **Link instead of repeating.** One page owns each topic; others link to its section (`ai.md#which-ai-answers`).

## Headers, footers and the order of a guide

Every Markdown page except `CLAUDE.md` starts with a pair of HTML comments, `tykerf:header` and `/tykerf:header`, and ends with another, `tykerf:footer` and `/tykerf:footer` (copy them from any page).

`npm run docs:nav` (`scripts/docs-nav.ts`) fills them with the logo, a breadcrumb, the previous and next pages and the project's links. **A guide's reading order is the order of the links in its index's table** (`user-guide/en/README.md`, `developer-guide/en/README.md`), so to add a page: write it with empty markers, add it to the index table where it belongs, and run `npm run docs:nav`.

`test/docs.test.ts` fails when a header or footer is out of date, when a Markdown file has none, or when a link points to a file or a `#section` that doesn't exist. Run `npx vitest run test/docs.test.ts` after editing docs.

## Screenshots and video

- **Screenshots** go in `docs/user-guide/images/` as PNG, taken from a real page in the editor at 1440 px wide (Playwright with `deviceScaleFactor: 2` gives sharp ones). Crop to what the text talks about, and describe the picture in its alt text.
- **The demo video** (`docs/media/tykerf-builds-lisbon.mp4`, with its poster `tykerf-builds-lisbon.jpg`) shows the whole flow: the start screen, one request, the build sped up, a tour of the finished page, its blocks in the editor and the phone view. GitHub doesn't play videos linked from Markdown inline, so pages link the poster to the file: `[![…](../../media/tykerf-builds-lisbon.jpg)](../../media/tykerf-builds-lisbon.mp4)`. Replace both together when the interface changes enough that the video no longer matches.
- **Keep people out of pictures.** Use made-up names and `example.com`/`example.org` addresses; no personal names, real domains other than TYKERF's own, keys, tokens or local paths that name someone.

## Translations

Each guide has a folder per language: `en/` today, `es/` and others next to it, with the same file names so links between guides keep working. The editor's interface strings are translated separately (see [Extending TYKERF](extending.md#a-translation)). A translated page follows the English one; when the English page changes, note it in the pull request so translators can follow.

<!-- tykerf:footer -->
---

← [Building on TYKERF](building-on-tykerf.md) · [Developer guide index](README.md)

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
