# Extending TYKERF

Step-by-step recipes. Each ends with the tests that guard it. Run `npm test && npm run typecheck` before sending a change (see [CONTRIBUTING.md](../../../CONTRIBUTING.md)).

## A component

A ready-made section people (and the AI) can drop into a box.

1. Add `library/components/<name>.html`: a `<style>` and the markup. The style applies to the box only (it is wrapped in `@scope`).
2. Register it in `library/components.json`: `"<name>": { "label": "…", "description": "…" }`. The description is what the AI reads in `list_components`, so say what the component holds.

Follow the house style:

```html
<style>
:scope { background: var(--section-bg, transparent); }       /* takes the band tones */
.wrap { max-width: var(--max-width); margin: 0 auto; padding: var(--space-section) var(--gap); }
.eyebrow { font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent); }
h2 { font-size: var(--text-title); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--gap); }
</style>
<div class="wrap">…</div>
```

The rules:
- **Theme variables only** for colours, fonts, sizes, radii and spacing. A test checks that every `var()` exists in the theme.
- **Paint the band with `var(--section-bg, …)`**, never a fixed colour, so `#tone-alt`, `#tone-soft` and `#tone-dark` work.
- **Work at any width**, because a box can be full width, a column or a phone: `auto-fit`/`minmax`, `flex-wrap`, `clamp()`.
- **Placeholder text says what to write**, and images come from `library/assets/` as `assets/<file>` (they are copied into the page).
- **No requests to other servers.** A script finds its box with `document.currentScript.closest('[data-sw]')` and stays inside it.

**Tests:** `test/library.test.ts` (variables, every layout in a browser) and `test/design.test.ts` (contrast, headings, phones), once a layout uses the component.

## A page layout

Add an entry to `library/layouts.json`:

```json
"pricing-page": {
  "label": "Pricing page",
  "description": "A headline, plans, a comparison and an FAQ",
  "layout": "nav[role=header] hero[role=section] pricing[role=section #tone-alt] faq[role=section] footer[role=footer #tone-dark] H5@page",
  "boxes": { "nav": "nav", "hero": "statement", "pricing": "pricing", "faq": "faq", "footer": "footer" }
}
```

- **`layout`** is the tree in the [notation](../../slicing-notation.md): boxes with roles and tags, then the operator. `H5@page` is a column of 5 named `page`. Rules go on further lines (`\nrule r1 below=900 flip body`).
- **`boxes`** gives the component for each box.
- **Tones:** alternate `#tone-alt` and `#tone-soft` bands, and keep `#tone-dark` for one or two sections, usually the footer.

The order in `layouts.json` is the order in the chooser. Keep the set small and clearly different: a layout should differ from the others in structure or density, not only in content. Ones that no longer earn their place go to `Other_Layouts/` (see [its README](../../../Other_Layouts/README.md)), not away. **Tests:** `test/library.test.ts` and `test/design.test.ts` pick up every layout automatically. Update the counts in `test/site-editor.test.ts` and the table in [the user guide](../../user-guide/en/layouts.md).

## A theme preset

Add an entry to `library/themes.json` with values for **existing** theme variables only. Anything you leave out keeps the theme's own value (`library/theme.html`).

```json
"harbour": { "label": "Harbour", "description": "Sea blue, sand bands and a serif voice",
  "values": { "--color-bg": "#fbfaf7", "--color-band": "#f1ede4", "--color-accent": "#0b5c7a",
              "--font-heading": "\"Newsreader\", Georgia, serif", "--radius-button": "999px" } }
```

- **Colours:** check contrast. The design test fails if secondary text or eyebrows on the alternate or soft band, or text on the accent, fall under WCAG AA (4.5:1).
- **Fonts:** installed fonts, or the bundled families in `FONTS` (`library.ts`): Inter, Manrope, DM Sans, Newsreader. To bundle another font:
  1. Add the Latin variable `.woff2` and its OFL licence to `library/fonts/`.
  2. Add the family to `FONTS`.
  3. Credit it in `NOTICE`.
- **Values** must pass `themeValueError`: colours, lengths, weights and font lists, with no `url()` and no `;{}<>`.

**Tests:** `test/library.test.ts` (the preset's variables and values) and `test/design.test.ts`. Add the preset to `PRESETS` there if it is one of the main ones.

## A theme variable

1. Add it to `:root` in `library/theme.html`, with a light default.
2. If it is a new kind, teach `themeValueError` its kind. Names are checked by prefix: `--color`, `--font`, `--text`, `--tracking`, `--weight`, `--radius`, `--gap`, `--space`, `--max-width`.
3. Give it a label in the Page tab (`THEME_LABELS` in `tykerf.js`). If it follows other colours, add it to `DERIVED` there too.

Band tones (`.t-tone-*`) may redefine variables. `withThemeValues` only touches `:root`, so changing a value never overwrites them. A new variable also works as a page's own value (`data-tykerf-override`) with no extra code, as long as `themeValueError` knows its kind.

## A move

A change to the tree, for people and the AI alike.

1. In `src/moves.ts`, write it on `mutate()`:
   ```ts
   export function flip(layout: Layout, opId: string): Layout {
     return mutate(layout, (l) => {
       const op = mustOp(l, opId);
       if (!isCut(op.kind)) throw new MoveError(`only H/V can be flipped, "${opId}" is ${op.kind}`);
       op.kind = op.kind === 'H' ? 'V' : 'H';
     });
   }
   ```
   `mutate` clones, applies and `finish`es: it drops rules and overlays whose target is gone, then re-validates. A move either returns a valid layout or throws a clear error.
2. Add it to the property test's move list in `test/moves.test.ts`, and give it its own tests.
3. Describe it in [docs/slicing-notation.md](../../slicing-notation.md).
4. Expose it:
   - **to the AI:** an MCP tool (next section);
   - **to people:** an editor operation (below).

## An MCP tool

In `createTykerfServer` (`src/mcp/tools.ts`):

- **For a tree move,** use `moveTool`:
  ```ts
  moveTool('flip', 'Turn a row into a column or a column into a row (rotation).', { op: id }, (l, a) => M.flip(l, a.op));
  ```
  Arguments declared with the shared `id` or `ids` schema are resolved through `resolveRef`. The change is scope-checked in `commit`, and the reply lists only the lines that changed.
- **For anything else,** use `server.registerTool(name, { description, inputSchema }, guard(...))`:
  - run read-modify-write inside `ws.transaction()`;
  - call `assertInScope` for the blocks it touches;
  - write a description that tells the model when to use the tool.

Speak *row* and *column* in descriptions and replies, never H/V. The Claude Desktop manifest picks up new tools by itself.

**Tests:** `test/mcp-scope.test.ts` (with and without a scope), and `test/runners.test.ts` if the API runners must handle it.

## An AI runner

1. In `src/editor/runners/<name>.ts`, implement `Runner`:
   - **`start`:** usually `runLoop(name, wire, req, on)` with a `Wire` for the provider's message format;
   - **`status()`:** ready, or why not (never print a key);
   - **`check()`:** one tiny real request;
   - **`describe(e)`:** errors in plain words.
2. Add it to `runnerFromEnv` (`runners/index.ts`) and `RUNNERS`. Give its label in `RUNNER_LABEL` (`tykerf.js`) and the chooser.
3. Document its variables in `.env.example`, [the AI guide](../../user-guide/en/ai.md#which-ai-answers) and `DEPLOY.md`.

**Tests:** a fake API server in `test/runners.test.ts` (tools in scope, refusals, steps, cancel, memory, errors). Never call a real API in tests.

## An editor operation

1. Add a handler to `OPS` in `src/editor/page.ts`. It receives the request body, runs inside `ws.transaction()` and saves with author `user`:
   ```ts
   flip: (a: { id: string }) => {
     ws.save(M.flip(ws.load(), a.id), `flip ${a.id}`, 'user');
     return a.id;
   },
   ```
2. In `tykerf.js`, call it with `op({ op: 'flip', id })` from a button or menu item. Every label goes through `t()`.

**Tests:** `test/editor.test.ts` (in a browser), or a direct `fetch` to `/_tykerf/op`. A new endpoint that changes state must sit behind `foreign()` (`editor/server.ts`).

## A translation

**The editor's interface:**
1. Add `src/editor/public/i18n/<lang>.json`, mapping each English string (the key, exactly as passed to `t()`) to its translation. Missing entries fall back to English.
2. Try it: the editor picks the browser's language; `localStorage['tykerf.lang'] = '"es"'` forces one.

**The guides:**
1. Copy `docs/user-guide/en/` to `docs/user-guide/<lang>/`, and `docs/developer-guide/en/` to `docs/developer-guide/<lang>/`.
2. Translate, keeping file names and anchors, so links between pages keep working.
3. Add the language to the indexes in `docs/user-guide/README.md`, `docs/developer-guide/README.md` and `docs/README.md`.

**Translated separately:** server messages, the AI's prompts (`CODE_RULES`, `BUILD_BRIEF`) and component placeholder text.
