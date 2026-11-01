<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Working with Kaity**
<!-- /tykerf:header -->

# Working with Kaity

**Kaity** is TYKERF's assistant: eonity's AI as it works in TYKERF (in Tydal, it is Aity). Its symbol is the three balls of eonity's isotype: still at rest, pulsing while Kaity works.

Kaity changes your page the same way you do: through named, validated moves on the tree, plus the code of each box. She never rewrites the whole page, she can't touch files or run commands, and every change she makes shows up in the history and can be undone.

This page explains what Kaity does and how to set her up. For how to write requests that get good results, and recipes for common jobs, read [Getting good results from Kaity](asking-kaity.md).

## Start a page with Kaity

On the start screen of a new site, or with **New page…**, choose **Show or describe it** (it is the first choice when Kaity is ready):

- **Show it** (drop, paste or choose up to three pictures: a screenshot of a page you like, a sketch, a mock-up, or a design exported as a ZIP file) and/or **describe it** ("a launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map"). Either one is enough; both together work best.
- **Build it with Kaity** makes the page and opens it at once, with a window that follows Kaity step by step while she builds the whole page (the page can't be clicked meanwhile, so nothing gets in her way). The **×** stops her. While she works, Kaity:
  - picks the layout that fits, and the theme unless you chose one;
  - plans the sections, starts them from components and rewrites their text;
  - alternates the bands and draws the illustrations she needs as SVG;
  - checks the result at desktop and phone widths and fixes what looks wrong;
  - goes once more over what she left unfinished (sample text, placeholder pictures, links without a target).

  Meanwhile the page comes into focus: sections Kaity hasn't reached are blurred, the one she's working on softly, and each section turns sharp once it's done. **See the page clearly** in the window turns the blur off. At the end, the window shows her summary, a short guide, and the choice between **Open the editor** (in the Tasks mode, ready for your first tasks) and **See the page**.
- **A design ZIP** (up to 8 MB, one per page; Google Stitch exports one): TYKERF opens it without running anything in it. Its pictures go to Kaity like the ones you drop (five in all), and its text files (`.md`, `.txt`, `.html`, `.css`, `.json`) go with your request as the reference; anything else is left out. The conversation shows only the file names. Kaity rebuilds the design with TYKERF's components and the theme; she doesn't copy code that loads things from other servers (Tailwind, Google Fonts, icon fonts).
- It uses your AI (see [Which AI answers](#which-ai-answers)) and takes a few minutes. Every step is a normal change: stop her, undo a step, or ask for more in the same conversation.
- When Kaity is not ready (Claude Code not installed, no key), the option says why and the other ways to start remain.

## Tasks: point, say, hand over

The editor starts in the **Tasks** mode. Click anything on the page, write what should change, and when you have them all press **Give Kaity every task**: she works through them, with each task's block, element and window width, and answers each one. The page follows her while she works. **Edit** is the whole editor, with the Kaity tab below for talking to her block by block. See [Tasks](editor.md#tasks).

## The Kaity tab

For a longer talk about one block, switch to the **Edit** mode, select the block and open its **Kaity** tab. (For quick changes, tasks are simpler.) A line above the text box says which block Kaity works on and which model answers; **Ask Kaity** sends it.

- **One conversation per block.** Kaity remembers what was said about this block; *New conversation* starts over.
- **She only changes the selected block** and what is inside it. Changes elsewhere are refused.
- **The theme** (colours, fonts, spacing of the whole page) can be changed by Kaity only when the top block, `page`, is selected: "make the accent pink", "use a serif font for headings". She can change the theme's values but nothing else in the page head, and never load fonts or files from other servers.
- **Images:** paste, drop or *Add image* (screenshots, sketches, reference designs; up to 5 per message). They are sent with your request and stay in the conversation. Kaity can also put one on the page ("use this photo in the banner"): it goes to the page's `assets/`.
- **Pictures on the page:** Kaity can't download pictures from the internet. She draws illustrations, icons and patterns as SVG, places pictures you attach, or says which picture is needed so you add it with the picture tool in the Text tab. She's told at once when a box points at a file the page doesn't have, and *what she leaves unfinished* lists it.
- **Where she is:** while Kaity works on a block, the block carries her pulsing balls in the tree, and the Kaity tab of any other block says where she is, with **Go there**. The site manager lists what she's doing on every page.
- **She looks at her work.** Kaity takes screenshots of the block at desktop (1440 px) and phone (375 px) widths and fixes what looks wrong.
- Her changes appear on the page as she works. *Stop* cancels the run; ⌘Z undoes a change.
- **What she leaves unfinished is listed.** After each request, TYKERF checks what the request added: sample text and pictures from layouts and components, and links that go nowhere or to a section or page that doesn't exist. Only what this request left is listed, never what you had already left that way. **Fix them** asks Kaity to finish them; **Leave them as they are** keeps them, and they aren't listed again. When Kaity builds a whole page, she gets one pass over the list herself before she finishes.
- **A page like another one:** ask for it ("make this page like rome", or from the start screen: "a page about Munich with the same layout as Rome"). Kaity knows the site's other pages and copies the one you name (`use_page`): its blocks, code and images, and its look if you ask; then she rewrites the text.
- **Links to pages that don't exist yet:** Kaity doesn't make up their addresses. She asks you whether those pages will be made, and the links stay in the list until you decide.
- **While she works, her block is locked:** you can keep editing the rest of the page, but changes to that block, and undo and redo, wait until Kaity is done (or you stop her).
- **Check the scripts she writes.** A `<script>` in a box runs in the editor with the same access as the editor itself, outside Kaity's scope. Look at the box's *Code* tab before reopening the page, or forbid scripts with a box type. See [SECURITY.md](../../../SECURITY.md).

## Kaity for the whole site

In the site manager, **Ask Kaity about the whole site** opens a conversation about every page at once: *"make the navigation the same height on every page, and link it to all the pages"*, *"add a footer like Rome's to every page"*. Kaity lists the pages, opens each in turn, changes it and checks it at desktop and phone widths, as Claude Desktop does with TYKERF's tools; her steps show as she goes, and **Stop** ends the run.

- Each change goes into the history of its page, so it can be undone there.
- While she works on the site, renaming or removing pages and asking Kaity about one page wait; you can keep editing pages yourself. She waits for a run on one page too.
- She can make, rename and remove pages: a rename changes the page's address, and links to it on every page follow; a removed page goes to the site's trash. Open tabs of a page she renames or removes follow it.
- She doesn't change the site's shared head (its theme, and Styles & scripts): those stay yours, in the site manager and the Page tab.
- She does change the [site kit](sites.md#the-site-kit) (shared blocks such as the navigation and the footer, styles and behaviours for every page) when you ask for it here, and tells you which pages a change reaches. Asked about one block, she can't change a shared block.
- Every request to her, about the site or about one block of any page, is listed in [Kaity's work](sites.md#kaitys-work).

## Which AI answers

The Kaity tab can use one of three runners, chosen with `TYKERF_RUNNER` in a `.env` file. TYKERF reads `.env` from the folder you start it in, then from the page or site folder; copy [.env.example](../../../.env.example) to start. The keys stay on your computer: they are never sent to the browser or written anywhere else. The line above the text box in the Kaity tab shows which runner and model answer.

| `TYKERF_RUNNER` | What answers | What it needs |
|---|---|---|
| `claude-code` (default) | Your installed [Claude Code](https://claude.com/claude-code) (`claude`) | Claude Code signed in: your Claude subscription, or the API key or endpoint Claude Code itself uses. No key in TYKERF. |
| `anthropic` | The Anthropic API, or any Anthropic-compatible endpoint (a proxy, or another provider's compatible API) | `TYKERF_API_KEY` (or `ANTHROPIC_API_KEY`); `TYKERF_AUTH_TOKEN` instead for endpoints that want a Bearer token; `TYKERF_API_BASE_URL` for an endpoint other than Anthropic's |
| `gemini` | Google's Gemini API | `GEMINI_API_KEY`; optionally `GEMINI_BASE_URL` |

**Site → Kaity status…** shows which runner and model answer, whether it's ready (Claude Code installed, or a key set), and what Kaity is working on now in any page. **Test** sends one short request, so a wrong key, address or model shows up before a real request fails.

`TYKERF_MODEL` picks the model. The defaults are `claude-sonnet-5-5` for `anthropic`, `gemini-pro-latest` for `gemini`, and Claude Code's own choice for `claude-code`. With a compatible endpoint, use the model names that endpoint offers.

Every runner gets the same tools, the same limit to the selected block, the same history and undo, and screenshots of its work. Notes on each:

- **claude-code:** TYKERF passes its environment on to Claude Code. So `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` in `.env` also send Claude Code to that endpoint (a proxy, for example). Use the `TYKERF_*` names when only the `anthropic` runner should use a key.
- **anthropic and gemini:** TYKERF runs the conversation itself and keeps the model's side of it per block, in `.tykerf/chats/<block>.api.json`. Old screenshots are dropped once the model has seen them, and the oldest requests go when the conversation grows long. A request stops after 40 steps; ask again to continue.
- **Changing runner:** after a change of `TYKERF_RUNNER`, a block's next request starts a fresh conversation for the model. What you see in the tab stays.

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
| Change a box | `set_content`, `edit_content` (one exact piece of the code), `add_picture` (an SVG it draws, or an attached picture) |
| Library and theme | `list_layouts`, `use_layout`, `list_components`, `use_component`, `use_page`, `list_themes`, `use_theme`, `get_theme`, `set_theme` |
| Pages of a site | `list_pages`, `open_page`, `new_page`, `rename_page`, `remove_page` |
| The site kit | `list_kit`, `get_kit_file`, `set_kit_file` (styles, behaviours, tags), `share_block`, `link_block`, `unlink_block` (shared blocks such as the navigation and the footer) |
| Tasks left on the page | `list_tasks`, `close_task` (with a reply for the person) |
| Open a folder (the plugin only) | `open_folder` (a page, a site or an empty folder; without a path, the default folder). Only the plugin starts with no folder open and offers it |
| Stay inside one block | `focus`, `unfocus` |
| Check the result | `screenshot`, `evaluate` (layout checks at several widths), `check_page` (what is left unfinished), `estimate`, `optimize` |
| History | `undo`, `redo`, `render` |

`screenshot` and `evaluate` need Chromium (`npx playwright install chromium`).

You can keep the editor open on the same page: changes made from the client appear in the browser as they happen.

<!-- tykerf:footer -->
---

← [Editing a page](editor.md) · [User guide index](README.md) · [Getting good results from Kaity](asking-kaity.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
