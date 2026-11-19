<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Working with Kaity**
<!-- /tykerf:header -->

# Working with Kaity

**Kaity** is TYKERF's assistant: eonity's AI as it works in TYKERF (in Tydal, it is Aity). Its symbol is the three balls of eonity's isotype: still at rest, pulsing while Kaity works.

Kaity changes your page the same way you do: through named, validated moves on the tree, plus the code of each box. She never rewrites the whole page, she can't touch files or run commands, and every change she makes shows up in the history and can be undone.

You ask her with **tasks**: point at anything on the page, say what should change, and hand your tasks over ([below](#tasks-point-say-hand-over)). Each task continues the conversation of its block, so she remembers what was asked there before; for the whole site there is [Kaity for the whole site](#kaity-for-the-whole-site). This page explains what Kaity does and how to set her up. For how to write requests that get good results, and recipes for common jobs, read [Getting good results from Kaity](asking-kaity.md).

## Start a page with Kaity

On **New page** (a new site opens on it; later, **+ Page** in the site's sidebar), Kaity comes first:

- **Show it** (drop, paste or choose up to three pictures: a screenshot of a page you like, a sketch, a mock-up, or a design exported as a ZIP file) and/or **describe it** ("a launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map"). Either one is enough; both together work best.
- **Build it with Kaity** makes the page and opens it at once in the editor: the bar says she is building it, with her latest step, and the tray lists every step. **Stop Kaity** stops her. While she works, Kaity:
  - picks the layout that fits, and the theme when the site has none yet;
  - plans the sections, starts them from components and rewrites their text;
  - alternates the bands and draws the illustrations she needs as SVG;
  - checks the result at desktop and phone widths and fixes what looks wrong;
  - goes once more over what she left unfinished (sample text, placeholder pictures, links without a target).

  Meanwhile the page fills in below the bar. At the end, the bar says *Your page is ready* and the tray shows her summary; **Got it** puts it away, ready for your first tasks. (In the full editor, the page comes into focus as she builds: sections she hasn't reached are blurred, the one she's working on softly, and each turns sharp once it's done.)
- **A design ZIP** (up to 8 MB, one per page; Google Stitch exports one): TYKERF opens it without running anything in it. Its pictures go to Kaity like the ones you drop (five in all), and its text files (`.md`, `.txt`, `.html`, `.css`, `.json`) go with your request as the reference; anything else is left out. The conversation shows only the file names. Kaity rebuilds the design with TYKERF's components and the theme; she doesn't copy code that loads things from other servers (Tailwind, Google Fonts, icon fonts).
- It uses your AI (see [Which AI answers](#which-ai-answers)) and takes a few minutes. Every step is a normal change: stop her, undo a step, or ask for more in the same conversation.
- When Kaity is not ready (Claude Code not installed, no key), New page says why and the other ways to start remain.

## Tasks: point, say, hand over

The editor opens every page in **Tasks**. Click anything on the page, write what should change, and when you have them all press **Give them to Kaity**: she works through them one at a time, each in its block, at the window width it was written at, and the tray shows each task as she goes. See [Tasks](editor.md#tasks).

- **Loose or exact.** A task can be as loose as "make the illustration more colorful" or as exact as "make the title six words at most". She looks at the page, decides, and tells you what she did. See [Writing a task](asking-kaity.md#writing-a-task).
- **Pictures with a task:** the picture button in the corner of the task box's field, or paste or drop one there (screenshots, sketches, reference designs; up to 5 per task). They go to Kaity with the task and show on its card. Kaity can also put one on the page ("use this photo in the banner"): it goes to the page's `assets/`.
- **Questions:** end it with `?` (the task's number turns into *Question*; a click on it switches back), or right-click → *Ask a question here…*: she answers and changes nothing.
- **She changes only the task's block** and what is inside it. Changes elsewhere are refused.
- **The theme** (colours, fonts, spacing of the whole page) changes only for a task on the top block, `page`: "make the accent pink", "use a serif font for headings". She can change the theme's values but nothing else in the page head, and never load fonts or files from other servers.
- **Pictures on the page:** Kaity can't download pictures from the internet. She draws illustrations, icons and patterns as SVG, places pictures you attach, or says which picture is needed so you add it by hand. She's told at once when a box points at a file the page doesn't have, and *what she leaves unfinished* lists it.
- **She looks at her work.** Kaity takes screenshots of the block at desktop (1440 px) and phone (375 px) widths and fixes what looks wrong. Her changes appear on the page as she works; **Stop Kaity** stops her.
- **The review.** Each task's card says what she changed, with *Before and after*, a way to check it (on a phone, by trying the link), *Undo this one* and *Ask for more*. **Undo all she did** takes the whole run back as one step.
- **What she leaves unfinished is listed on the card.** After each task, TYKERF checks what it added: sample text and pictures from layouts and components, and links that go nowhere or to a section or page that doesn't exist. Only what this task left is listed, never what you had already left that way. **Fix them** asks Kaity to finish them, as part of the task (so *Undo this one* takes both); **Leave them as they are** keeps them, and they aren't listed again. When Kaity builds a whole page, TYKERF also checks its design (the must-fix part of *Check the design*: text too faint or too small, buttons too small to tap, headings out of order, sideways scroll, lines too long or cramped, stretched pictures); she gets one pass over the list herself before she finishes, and whatever is still there is listed on the card like the rest.
- **Her conversation:** *See her conversation on …* on a card shows everything asked on that block, her steps and answers, to read. Every task on the block continues it.
- **A page like another one:** ask for it ("make this page like rome", or for the whole site: "a page about Munich with the same layout as Rome"). Kaity knows the site's other pages and copies the one you name (`use_page`): its blocks, code and images, and its look if you ask; then she rewrites the text.
- **Links to pages that don't exist yet:** Kaity doesn't make up their addresses. She asks you whether those pages will be made, and the links stay in the list until you decide.
- **While she works, her block is locked:** you can look around, but changes to that block, and undo and redo, wait until Kaity is done (or you stop her). The site's **Kaity's work** lists what she's doing on every page; in the full editor, her block carries her pulsing balls in the tree.
- **Every task is a normal request.** It is in the block's conversation word for word, in [Kaity's work](sites.md#kaitys-work), and every step she takes is one undo step.
- **Not only for Kaity.** *Copy all for another agent* gives the open tasks as text for any AI agent, and MCP clients read and close them too (`list_tasks`, `close_task`).
- **Check the scripts she writes.** A `<script>` in a box runs in the editor with the same access as the editor itself, outside Kaity's scope. Look at the box's *Code* tab in the full editor before reopening the page, or forbid scripts with a box type. See [SECURITY.md](../../../SECURITY.md).

## Kaity for the whole site

**Ask Kaity about the whole site**, at the top of the site's sidebar, opens a conversation about every page at once (on the site's **Kaity's work**): *"make the navigation the same height on every page, and link it to all the pages"*, *"add a footer like Rome's to every page"*. Kaity lists the pages, opens each in turn, changes it and checks it at desktop and phone widths, as Claude Desktop does with TYKERF's tools; her steps show as she goes, and **Stop** ends the run.

- Each change goes into the history of its page, so it can be undone there.
- While she works on the site, renaming or removing pages and asking Kaity about one page wait; you can keep editing pages yourself. She waits for a run on one page too.
- She can make, rename and remove pages: a rename changes the page's address, and links to it on every page follow; a removed page goes to the site's trash. Open tabs of a page she renames or removes follow it.
- When each page has a theme of its own (a site from before shared themes, or one built page by page in Claude), she can make one page's theme the one every page shares (`share_theme`): *"use the home page's colours and fonts on every page"*. The other pages give up their own theme, each with one undo step on the page, and the site theme's own **Undo** in the Page tab takes the shared theme back. Copies of websites keep their own look.
- She sets the site's language when you ask (`set_site`). Otherwise the site's shared head (its theme's values, and its head code) stays yours, in the site's screens and the full editor's Page tab.
- She does change the [site kit](sites.md#the-site-kit) (shared blocks such as the navigation and the footer, styles and behaviours for every page) when you ask for it here, and tells you which pages a change reaches. On a page, she changes a shared block only when you ask her about the whole page (the page block selected), and says which pages it reached; asked about a smaller block, she can't, but she can fill its [slots](sites.md#slots) for that page.
- Every request to her, about the site or about one block of any page, is listed in [Kaity's work](sites.md#kaitys-work).

## Which AI answers

Kaity can use one of three runners, chosen with `TYKERF_RUNNER` in a `.env` file. TYKERF reads `.env` from the folder you start it in, then from the page or site folder; copy [.env.example](../../../.env.example) to start. The keys stay on your computer: they are never sent to the browser or written anywhere else.

| `TYKERF_RUNNER` | What answers | What it needs |
|---|---|---|
| `claude-code` (default) | Your installed [Claude Code](https://claude.com/claude-code) (`claude`) | Claude Code signed in: your Claude subscription, or the API key or endpoint Claude Code itself uses. No key in TYKERF. |
| `anthropic` | The Anthropic API, or any Anthropic-compatible endpoint (a proxy, or another provider's compatible API) | `TYKERF_API_KEY` (or `ANTHROPIC_API_KEY`); `TYKERF_AUTH_TOKEN` instead for endpoints that want a Bearer token; `TYKERF_API_BASE_URL` for an endpoint other than Anthropic's |
| `gemini` | Google's Gemini API | `GEMINI_API_KEY`; optionally `GEMINI_BASE_URL` |

**Kaity status**, on the site's *Head code, icon & language* screen (in the site sidebar), shows which runner and model answer and whether it's ready (Claude Code installed, or a key set); **Kaity's work** shows what she is working on now in any page. **Test it** sends one short request, so a wrong key, address or model shows up before a real request fails.

`TYKERF_MODEL` picks the model. The defaults are `claude-sonnet-5-5` for `anthropic`, `gemini-pro-latest` for `gemini`, and Claude Code's own choice for `claude-code`. With a compatible endpoint, use the model names that endpoint offers.

Every runner gets the same tools, the same limit to the selected block, the same history and undo, and screenshots of its work. Notes on each:

- **claude-code:** TYKERF passes its environment on to Claude Code. So `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` in `.env` also send Claude Code to that endpoint (a proxy, for example). Use the `TYKERF_*` names when only the `anthropic` runner should use a key.
- **anthropic and gemini:** TYKERF runs the conversation itself and keeps the model's side of it per block, in `.tykerf/chats/<block>.api.json`. Old screenshots are dropped once the model has seen them, and the oldest requests go when the conversation grows long. A request that stops (after 40 steps, or because the model service is slow or busy) goes on by itself while she is getting somewhere; otherwise it ends unfinished, and **Continue** lets her go on.
- **Changing runner:** after a change of `TYKERF_RUNNER`, a block's next request starts a fresh conversation for the model. The conversation you read stays.

A hosted TYKERF server will use these runners with its own key; see the [roadmap](../../../ROADMAP.md).

## TYKERF from your own AI client (MCP)

TYKERF's moves are also an MCP server, so any MCP client can edit a TYKERF page directly. The client starts the server on your computer. Use absolute paths.

**Claude Code and Cowork:** install the TYKERF plugin from TYKERF's own marketplace. In Claude Code, `/plugin marketplace add eonity-org/tykerf`, then `/plugin install tykerf@eonity.org`; in Cowork, *Customize → Plugins → Add marketplace* and `eonity-org/tykerf`. It brings a skill that tells Claude how to work with TYKERF, and starts with no folder open: Claude opens the one you name (see [TYKERF in Claude Code and Cowork](claude-plugin.md)). Or add the server by hand in Claude Code:

```bash
claude mcp add tykerf -- /path/to/tykerf/node_modules/.bin/tsx /path/to/tykerf/src/mcp/server.ts --dir /path/to/page
```

**Claude Desktop:** install the TYKERF extension, one click and no config (see [TYKERF in Claude Desktop](claude-desktop.md)). Or add the server by hand, as for other clients with a JSON config (Settings → Developer → Edit Config, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tykerf": {
      "command": "/path/to/tykerf/node_modules/.bin/tsx",
      "args": ["/path/to/tykerf/src/mcp/server.ts", "--dir", "/path/to/page"]
    }
  }
}
```

Restart the client after editing the config. The tools, by what they do:

| | Tools |
|---|---|
| Read the page | `get_layout` (the tree as an outline), `get_content`, `get_types`, `resolve` (what a name or path points to) |
| Change the tree | `split`, `add_leaf`, `wrap`, `unwrap`, `flip`, `swap`, `move`, `remove`, `rename`, `set_ratios`, `set_op`, `set_leaf`, `set_variant`, `tag`, `untag`, `add_rule`, `remove_rule`, `attach_overlay`, `detach_overlay`, `normalize` |
| Change a box | `set_content`, `edit_content` (one exact piece of the code), `add_picture` (an SVG it draws, or an attached picture), `add_file`, `add_files` (pictures, fonts, PDFs from an address, an attached picture, or with Claude Desktop and the plugin a file on your computer, to the page or the site) |
| Library and theme | `list_layouts`, `use_layout`, `list_components`, `use_component`, `use_page`, `list_themes`, `use_theme`, `get_theme`, `set_theme` |
| Pages of a site | `list_pages`, `open_page`, `new_page`, `rename_page`, `remove_page`, `set_title` (a page's title), `set_site` (the site's language), `share_theme` (one page's theme for every page), `set_slot` (a shared block's slot, for one page), `list_files`, `remove_file` (the site's files and every page's) |
| The site kit | `list_kit`, `get_kit_file`, `set_kit_file` (styles, behaviours, tags), `share_block`, `link_block`, `unlink_block` (shared blocks such as the navigation and the footer) |
| Tasks left on the page | `list_tasks`, `close_task` (with a reply for the person) |
| Open a folder (the plugin only) | `open_folder` (a page, a site or an empty folder; without a path, the default folder). Only the plugin starts with no folder open and offers it |
| Stay inside one block | `focus`, `unfocus` |
| Check the result | `screenshot`, `evaluate` (layout checks at several widths), `check_page` (what is left unfinished), `estimate`, `optimize`, `check_site` (the whole site, on a run over the site) |
| History | `undo`, `redo`, `render` |

`screenshot` and `evaluate` need Chromium (`npx playwright install chromium`).

You can keep the editor open on the same page: changes made from the client appear in the browser as they happen.

<!-- tykerf:footer -->
---

← [Editing a page](editor.md) · [User guide index](README.md) · [Getting good results from Kaity](asking-kaity.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
