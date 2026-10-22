<!-- tykerf:header -->
[<img src="../../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Working with Kaity**
<!-- /tykerf:header -->

# Working with Kaity

**Kaity** is TYKERF's assistant: eonity's AI as it works in TYKERF (in Tydal, it is Aity). Its symbol is the three balls of eonity's isotype: still at rest, pulsing while Kaity works.

Kaity changes your page the same way you do: through named, validated moves on the tree, plus the code of each box. It never rewrites the whole page, it can't touch files or run commands, and every change it makes shows up in the history and can be undone.

## Start a page with Kaity

On the start screen of a new site, or with **New page…**, choose **Show or describe it** (it is the first choice when Kaity is ready):

- **Show it** (drop, paste or choose up to three pictures: a screenshot of a page you like, a sketch, a mock-up, or a design exported as a ZIP file) and/or **describe it** ("a launch page for our bakery in Murcia: warm and simple, our three best breads, opening hours and a map"). Either one is enough; both together work best.
- **Build it with Kaity** makes the page and opens it at once, with a window that follows Kaity step by step while it builds the whole page (the page can't be clicked meanwhile, so nothing gets in its way). The **×** stops it. At the end, the window shows its summary, a short guide, and the choice between **Open the editor** (on the page's Kaity tab) and **See the page**. While it works, Kaity: it plans the sections, starts them from components, adapts their text, alternates the bands and checks the result at desktop and phone widths. Before it finishes, it goes once more over what it left unfinished (sample text, placeholder pictures, links without a target). Meanwhile the page comes into focus: sections Kaity hasn't reached are blurred, the one it's working on softly, and each section turns sharp once it's done. **See the page clearly** in the window turns the blur off.
- **A design ZIP** (up to 8 MB, one per page; Google Stitch exports one): TYKERF opens it without running anything in it. Its pictures go to Kaity like the ones you drop (five in all), and its text files (`.md`, `.txt`, `.html`, `.css`, `.json`) go with your request as the reference; anything else is left out. The conversation shows only the file names. Kaity rebuilds the design with TYKERF's components and the theme; it doesn't copy code that loads things from other servers (Tailwind, Google Fonts, icon fonts).
- It uses your AI (see [Which AI answers](#which-ai-answers)) and takes a few minutes. Every step is a normal change: stop it, undo a step, or ask for more in the same conversation.
- When Kaity is not ready (Claude Code not installed, no key), the option says why and the other ways to start remain.

## The Kaity tab

Select a block and open the **Kaity** tab. A line above the text box says which block Kaity works on and which model answers; **Ask Kaity** sends.

- **One conversation per block.** Kaity remembers what was said about this block; *New conversation* starts over.
- **It only changes the selected block** and what is inside it. Changes elsewhere are refused.
- **The theme** (colours, fonts, spacing of the whole page) can be changed by Kaity only when the top block, `page`, is selected: "make the accent pink", "use a serif font for headings". It can change the theme's values but nothing else in the page head, and never load fonts or files from other servers.
- **Images:** paste, drop or *Add image* (screenshots, sketches, reference designs; up to 5 per message). They are sent with your request and stay in the conversation. Kaity can also put one on the page ("use this photo in the banner"): it goes to the page's `assets/`.
- **Pictures on the page:** Kaity can't download pictures from the internet. She draws illustrations, icons and patterns as SVG, places pictures you attach, or says which picture is needed so you add it with the picture tool in the Text tab. She's told at once when a box points at a file the page doesn't have, and *what it leaves unfinished* lists it.
- **Where she is:** while Kaity works on a block, it carries her pulsing balls in the tree, and the Kaity tab of any other block says where she is, with **Go there**. The site manager lists what she's doing on every page.
- **It looks at its work.** Kaity takes screenshots of the block at desktop (1440 px) and phone (375 px) widths and fixes what looks wrong.
- Its changes appear on the page as it works. *Stop* cancels the run; ⌘Z undoes a change.
- **What it leaves unfinished is listed.** After each request, TYKERF checks what the request added: sample text and pictures from layouts and components, and links that go nowhere or to a section or page that doesn't exist. Only what this request left is listed, never what you had already left that way. **Fix them** asks Kaity to finish them; **Leave them as they are** keeps them, and they aren't listed again. When Kaity builds a whole page, she gets one pass over the list herself before she finishes.
- **A page like another one:** ask for it ("make this page like rome", or from the start screen: "a page about Munich with the same layout as Rome"). Kaity knows the site's other pages and copies the one you name (`use_page`): its blocks, code and images, and its look if you ask; then it rewrites the text.
- **Links to pages that don't exist yet:** Kaity doesn't make up their addresses. She asks you whether those pages will be made, and the links stay in the list until you decide.
- **While it works, its block is locked:** you can keep editing the rest of the page, but changes to that block, and undo and redo, wait until Kaity is done (or you stop it).
- **Check the scripts it writes.** A `<script>` in a box runs in the editor with the same access as the editor itself, outside Kaity's scope. Look at the box's *Code* tab before reopening the page, or forbid scripts with a box type. See [SECURITY.md](../../../SECURITY.md).

## Kaity for the whole site

In the site manager, **Ask Kaity about the whole site** opens a conversation about every page at once: *"make the navigation the same height on every page, and link it to all the pages"*, *"add a footer like Rome's to every page"*. Kaity lists the pages, opens each in turn, changes it and checks it at desktop and phone widths, as Claude Desktop does with TYKERF's tools; her steps show as she goes, and **Stop** ends the run.

- Each change goes into the history of its page, so it can be undone there.
- While she works on the site, renaming or removing pages and asking Kaity about a single page wait; you can keep editing pages yourself. She waits for a run on a single page too.
- She doesn't change the site's shared head (its theme, and Styles & scripts): those stay yours, in the site manager and the Page tab.

## Which AI answers

The Kaity tab can use one of three runners, chosen with `TYKERF_RUNNER` in a `.env` file. TYKERF reads `.env` from the folder you start it in, then from the page or site folder; copy [.env.example](../../../.env.example) to start. The keys stay on your computer: they are never sent to the browser or written anywhere else. The tab shows which runner and model answer, next to *Send*.

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

**Claude Code:**

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

Restart the client after editing the config. The tools include `get_layout`, `split`, `wrap`, `flip`, `swap`, `move`, `set_ratios`, `set_content`, `edit_content`, `add_picture`, `rename`, `undo`, `redo`, `get_theme`, `set_theme`, `list_themes`, `use_theme`, `list_layouts`, `use_layout`, `list_components`, `use_component`, `evaluate` (layout checks at several widths) and `screenshot` (needs `npx playwright install chromium`).

You can keep the editor open on the same page: changes made from the client appear in the browser as they happen.

<!-- tykerf:footer -->
---

← [Editing a page](editor.md) · [User guide index](README.md) · [Layouts, components and the theme](layouts.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
