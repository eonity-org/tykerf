<!-- tykerf:header -->
&nbsp;

[<img src="src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](README.md) › **Contributing to TYKERF**
<!-- /tykerf:header -->

# Contributing to TYKERF

Thanks for helping. TYKERF is an eonity project; issues and pull requests are welcome at https://github.com/eonity-org/tykerf.

The [developer guide](docs/developer-guide/en/README.md) explains how TYKERF works and how to extend it, step by step: components, layouts, theme presets, moves, MCP tools, AI runners, editor operations and translations.

## Setup

```bash
npm install
npx playwright install chromium
npm test && npm run typecheck
npm start -- examples/widgets      # http://localhost:4400
```

## Ground rules

- **The tree is never left invalid.** Every move in `src/moves.ts` is pure (`clone → mutate → finish`) and either returns a valid layout or throws. New moves go through `mutate()`, get a test, and keep the property test in `test/moves.test.ts` passing.
- **The notation spec is the contract.** If you change the grammar, a move or a reference form, update [docs/slicing-notation.md](docs/slicing-notation.md) in the same pull request.
- **Docs pages have a header and footer** (the logo, where the page sits, the previous and next pages of its guide). They are written by `npm run docs:nav`: run it after adding a page, renaming one or reordering a guide's index, and `npm test` checks they're current and that every link leads somewhere.
- **People and the AI share one tree and one history.** Changes go through `Workspace` (`save`, `setContent`, `rename`, `group`), never by writing workspace files directly, so they are validated, typed, scope-checked and undoable.
- **The AI's vocabulary is row/column**, never the letters H/V (a model once read `H` as "horizontal row").
- **The editor client stays build-free:** plain browser JS in `src/editor/public/`, all UI inside the shadow root.
- **Every interface string goes through `t()`** in `src/editor/public/tykerf.js` (see Translations).
- **No third-party requests from the editor.** Fonts and assets are bundled and served from `/_tykerf/`; a CDN request would disclose the visitor's IP address.
- Match the surrounding code: naming, comment density, small focused functions.

## Layouts and components

Page layouts and components live in `library/` (`layouts.json`, `components.json`, `components/*.html`, `theme.html`, `assets/`). A component:

- styles its own box through `:scope` and uses **only the theme's CSS variables** for colours, fonts, radius and spacing (a test checks this);
- adapts to its width (`grid` with `auto-fit`/`minmax`, `flex-wrap`, `clamp()`), because a box can be full width, a column or a phone screen;
- uses placeholder text that says what to write, and images from `library/assets/` as `assets/<file>`;
- makes no requests to other servers, and keeps scripts inside its box (`document.currentScript.closest('[data-sw]')`).

Every page layout is rendered in a test at 375 and 1440 px and must have no horizontal scroll and no broken images. `test/design.test.ts` also checks every layout in the main presets for readable contrast on every band and for heading order. See [Extending TYKERF](docs/developer-guide/en/extending.md#a-component).

## Translations

The editor's interface is written in English, and every string shown to people is wrapped in `t()`:

```js
t('Add beside')
t('Renamed to {name}', { name })                     // placeholders in braces
t('Take out the box {id}?', { id: `<b>${esc(id)}</b>` })   // values going into HTML are escaped first
```

The English text is the key. A translation is a JSON file in `src/editor/public/i18n/<lang>.json` (two-letter language code) mapping English strings to translated ones; missing entries fall back to English. The editor picks the browser's language; `localStorage['tykerf.lang']` (for example `"es"`) overrides it. Use whole sentences as keys, including plural forms as separate keys (`'1 step'`, `'{n} steps'`), so translators never have to assemble fragments.

Server error messages, the AI's prompts and the guides (`docs/user-guide/<lang>/`, `docs/developer-guide/<lang>/`, next to `en/`) are translated separately; see [Extending TYKERF](docs/developer-guide/en/extending.md#a-translation).

## Pull requests

- One topic per pull request, with a short description of what changes for users.
- `npm test` and `npm run typecheck` pass.
- For editor changes, include a screenshot or a short recording.
- By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).

## Reporting security issues

Please don't open a public issue; see [SECURITY.md](SECURITY.md).

<!-- tykerf:footer -->
---

[TYKERF](README.md) · [Documentation](docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
