<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../README.md) › [Roadmap](../../ROADMAP.md) › **Plan: tasks, the handbook and two components**
<!-- /tykerf:header -->

# Plan: tasks, the handbook and two components

Branch `improvingui`. Three pieces, each usable on its own.

## 1. Tasks on the page

A person points at any element of the page and leaves a task to be done: a change to make, a question, something to check. Each task knows **the block**, **the element inside it** (an element path, as editing in place uses) and **the window width** it was written at, so whoever picks it up knows exactly where and at which size.

- **Storage:** `src/tasks.ts`, `.tykerf/tasks.json` per page, through `ws.store` and `ws.transaction`. Tasks are not part of the page: no undo, not exported. A task keeps the block name it was written on and follows renames through `Workspace.followRenames`; a task whose block is gone says so.
- **Editor:** a **Tasks** button in the panel header turns task mode on. In task mode the pointer outlines the element under it with a label (`block › h2 "First words…"`); a click opens a popover there (Cancel / Add). Open tasks show as numbered tabs on their element's top-right corner, which follow it. A bar at the bottom of the window shows how many tasks are open, lists them, shows or hides the pins, copies them all as text for any agent, and leaves task mode. A tab opens its task: **Done**, **Remove**, **Give it to Kaity**.
- **Kaity:** *Give it to Kaity* sends a block's open tasks (or the whole page's) to its conversation (the chat shows each task; Kaity also gets its element path) and she closes each one with `close_task` when it is done.
- **MCP:** `list_tasks` (the open tasks inside the scope) and `close_task` (number, reply), so Claude Code, Cowork or Desktop can work through the tasks too.
- **Server:** `GET /_tykerf/tasks`, `POST /_tykerf/tasks/{add,close,reopen,remove,clear,ask}`; an SSE `tasks` event when they change (also from the MCP child, through the store watcher).

## 2. The handbook

`/_tykerf/handbook/` for a page (linked from the Page tab): the page's system on one page, generated from the page itself, so it is never out of date.

- **Theme:** colours as swatches, fonts as specimens, lengths (spacing, radius, widths) as bars, each with its variable name and a copy button.
- **Blocks:** every block in tree order with **copy chips** (name, path, `#sw-<name>` link) and its kind, type and tags; a box also shows its first words; and the block's tasks, open ones first, then the ones that are done with their reply (the record of what was decided).

## 3. Two components

- `steps-rail` *Steps on a line*: three or four steps on a horizontal line that fills as the section scrolls into view (CSS scroll-driven animation; complete where it isn't supported or motion is reduced). A column on a phone.
- `hero-switch` *Hero with a switcher*: one hero, several audiences or use cases chosen from pills; the headline, text and figures change. CSS only (radio inputs and `:has()`), keyboard-accessible.

## Docs and tests

`test/tasks.test.ts` (storage, renames, scope, MCP tools), editor endpoint tests next to the existing ones, the library tests cover the components. User guide: a *Tasks* section in `editor.md` and `asking-kaity.md`; developer guide: `editor.md`, `ai-and-mcp.md`; the plugin skill names the two new tools.

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
