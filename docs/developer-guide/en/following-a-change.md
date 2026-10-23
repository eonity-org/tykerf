<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [Developer guide](README.md) › **Following a change**
<!-- /tykerf:header -->

# Following a change

[Architecture](architecture.md) describes the parts; this page shows them working together. It follows one small change, a new box beside another, three times: made by a person in the editor, made by Kaity, and undone. Read it with the code open: every step names the file and function that does it. After this page, the reference pages ([the editor](editor.md), [the AI and MCP](ai-and-mcp.md)) should read as detail rather than as a map.

## 1. A person clicks *Add beside*

The box `hero` is selected in the panel; the person clicks **Add beside**.

1. **The client asks; it never edits.** The button in `tykerf.js` (`data-act="insert"`) calls `op({ op: 'insert', id: 'hero', as: 'row' })`, a `POST` to `_tykerf/op` relative to the page. The browser holds no copy of the tree it could change: it only asks for named operations.
2. **The server checks who is asking.** `foreign()` in `editor/server.ts` refuses another `Host` header, another `Origin`, or a body that isn't JSON. Every request that changes something passes here first.
3. **The page host runs the operation in a transaction.** `createPageHost` (`editor/page.ts`) finds `OPS.insert` and runs it inside `ws.transaction()`: the store's lock, so the AI's MCP process (another process, same folder) can't write between the read and the write.
4. **The operation is a move.** `OPS.insert` loads the tree (`ws.load()`), picks a free name (`newBoxName`, here `box-1`) and calls `M.insertNext(layout, 'hero', 'V', 'box-1')` in `moves.ts`.
5. **The move can't leave the tree broken.** Like every move, `insertNext` runs on `mutate()`: it clones the layout, changes the clone (joins the parent row, or wraps `hero` and the new box in a new row `o<n>`), then `finish()` drops rules and overlays whose target vanished and runs `validate()`. It returns a valid layout or throws a `MoveError`, and the request answers with that error.
6. **Saving checks again and keeps the past.** `ws.save(next, 'add box-1 beside hero', 'user')` in `workspace.ts`:
   - serializes the tree; nothing happens if it didn't change;
   - `checkTypes` refuses a change that *introduces* a box-type violation (`types.ts`);
   - `checkGuards` asks every guard on this `Workspace` object (the editor's lock on Kaity's block, if she is running);
   - `log()` appends a history entry with the label, the author, the time and the **previous** `layout.slice`, and clears the redo list;
   - writes the new `layout.slice` through the store.
7. **Open pages refresh.** Back in `page.ts`, `changed()` waits 80 ms (to merge bursts) and sends the server-sent event `changed` to every open tab of the page. `tykerf.js` reloads `_tykerf/state` (the tree for the panel) and the page's body, and selects the new box.

Everything after step 3 is the same code the CLI and the MCP server use. That is the point of the design: there is one way to change a page.

## 2. Kaity makes the same change

The page has a column `intro` holding the box `hero`. The person selects `intro`, opens the **Kaity** tab and writes "put a picture beside the hero text".

1. **The request starts a run.** `POST _tykerf/ask` calls `ai.ask('intro', prompt, …)` in `editor/ai.ts`. `ask`:
   - notes what the page has left unfinished now (`leftovers`, `check.ts`), to compare at the end;
   - **locks the block:** `ws.addGuard(lockBlock(…))` makes the editor's own `Workspace` refuse changes inside `intro` until the run ends, so the person and Kaity never edit the same block at once;
   - builds the system prompt (the block, the scope rule, `CODE_RULES`) and calls `runner.start(…)` with `scope: 'intro'`.
2. **The runner gives the model TYKERF's tools and nothing else.** With the default `claude-code` runner, `ClaudeCodeRunner` spawns `claude -p` with `--tools ""` (no files, no shell), `--strict-mcp-config` and an MCP config that starts `src/mcp/server.ts --dir <page> --scope intro`. The API runners (`runners/loop.ts`) open the same tools in-process instead (`tools-client.ts`, `openTools`).
3. **The model calls a tool.** Say it calls `split` with `{ leaf: 'hero', kind: 'row', names: ['hero-picture'] }`: `hero` becomes a row of itself and a new empty box. In `mcp/tools.ts`, every tree tool is a `moveTool`, which:
   - runs inside `ws.transaction()`, like the editor's operations;
   - resolves every block argument with `resolveRef` (`refs.ts`), so `hero`, `intro/hero` or a position such as `#2.1` all work and the history logs the real name;
   - applies the move from `moves.ts`, the same function family the editor uses.
4. **The scope is checked on the result, not on the request.** `commit(prev, next, label)` calls `scopeViolation` (`scope.ts`): it compares the page *outside* `intro` before and after (`outsideSignature`). The new row sits inside `intro`, so the change passes. Had anything outside changed, the tool would answer `refused: …` and save nothing. The model can't talk its way around it, because the check never reads what the model said.

   This is also why the person selected `intro` rather than `hero`. With the scope on the box `hero`, Kaity may change its code (`set_content`, `edit_content`) but not split it: a split replaces `hero`'s place in the tree with a new row, and that place is outside `hero`. The tool refuses with *this change would modify the page outside the scope "hero"*, and Kaity tells the person to select the block around it. Structural changes need the scope one level up.
5. **Saving is the same `ws.save`,** with author `ai`. It runs in the MCP server's process, so the editor learns about it from the folder: the store's watcher (`store.watch` in `page.ts`) sees `layout.slice` change and calls the same `changed()`, and open pages refresh as in step 1.7.
6. **People see each step.** The runner reports every tool call through `RunEvents.step`; `ai.ts` adds it to the block's conversation and sends the SSE `ai` event, which the Kaity tab shows as it happens. A model that screenshots its work calls `screenshot` (`screenshot.ts`, Playwright), which renders the page with `ws.page()` like any other render.
7. **The run ends.** On the model's answer, `ask` removes the guard (the block unlocks), compares `leftovers` with the snapshot from step 1 and, when the request added sample text, placeholder pictures or dead links, ends the conversation with a `check` message (*Fix them* / *Leave them*).

## 3. The person presses ⌘Z

1. `POST _tykerf/undo` in `page.ts` answers **409** while Kaity is running: undoing half of a run would leave a state nobody made.
2. Otherwise `ws.undo()` (`workspace.ts`), in a transaction, pops the last history entry and puts back what it recorded: the previous `layout.slice` for a tree change, the previous code for a `content` entry, the previous head for a `head` entry. A `group` entry (several changes saved as one step by `ws.group(label, author, fn)`) undoes all of its parts.
3. The undone step and the state it replaced go on `.redo.jsonl`, so **Redo** can bring it back until the next new change.
4. `changed()` refreshes open pages, as always.

Kaity's changes and the person's are entries in **one** history, so ⌘Z takes back the last change whoever made it.

## 4. Rendering what changed

Every view of the page, whether the editor, a screenshot, an export or `npm run cli -- render`, comes from `ws.page()`:

1. `effective(layout, width)` (`model.ts`) is the tree at a given width, after responsive rules. The renderer turns each rule into a media query from it, and the shape model uses the same function, so both agree on what a rule means.
2. `renderParts` (`render.ts`) walks the tree in reading order: rows and columns become flexbox elements, `W` and `P` become CSS grids, each block gets `data-sw="<name>"`, and each box's code goes inside its element.
3. `scopeStyles()` wraps each box's `<style>` in `@scope ([data-sw="<name>"])`, so one box's CSS can't reach another's.
4. The head is the site's shared head (`ws.siteHead()`, when the page belongs to a site) followed by the page's own `head.html`.

## Finding your way when something misbehaves

- **Read the history.** `.history.jsonl` in the page folder has one line per step, with label, author and time. Most "what changed this?" questions end there.
- **Watch the events.** In the browser's developer tools, the `_tykerf/events` request shows every `changed`, `ai` and `job` event as it arrives.
- **Outline a tree.** `npm run cli -- outline "nav hero main V footer H3"` parses a postfix string and prints the tree with positions; `get_layout` does the same for a page over MCP.
- **Reproduce without the editor.** A move, a save or an undo is a few lines of TypeScript against `Workspace` (see [Building on TYKERF](building-on-tykerf.md)), and a failing case usually becomes a test in `test/moves.test.ts` or `test/redo.test.ts` with no browser at all.
- **Keep your `.env` out of it.** `TYKERF_DOTENV=off` starts the editor without reading `.env` files, as the tests do.

<!-- tykerf:footer -->
---

← [Architecture](architecture.md) · [Developer guide index](README.md) · [The editor](editor.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
