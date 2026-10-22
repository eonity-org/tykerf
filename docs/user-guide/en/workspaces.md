<!-- tykerf:header -->
[<img src="../../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Pages and the notation**
<!-- /tykerf:header -->

# Pages and the notation

What a page is made of, on disk and in the notation. For a site's pages, its site manager and its theme, see [Your site](sites.md).

## A page

A TYKERF page is a folder, called a workspace:

| File | What it holds |
|---|---|
| `layout.slice` | The tree, in slicing notation |
| `boxes/<id>.html` | Each box's code: any HTML, with its own `<style>` (applies only to that box) and `<script>` |
| `types/<type>.json` | Optional box types: what may go where, which tags and scripts a box may use |
| `head.html` | The page `<head>` additions: the theme, fonts, page-wide styles and scripts (the Page tab) |
| `assets/` | Images and files the boxes use, as `assets/<file>`; copied to `out/assets/` when rendering. Files nothing uses go to `.trash/` from the Page tab (*Unused files*) |
| `.history.jsonl` | Every change, with who made it (`user` or `ai`), for undo and audit |
| `.redo.jsonl` | Undone changes that Redo can bring back (cleared by the next new change) |
| `.images.json` | Images the image tool cropped, turned or scaled, and the original each came from (so a crop can be undone) |
| `.tykerf/` | Editor state: conversations with Kaity, attached images, the removed-code buffer (not for git) |
| `out/` | The rendered page, `index.html` (not for git; regenerate it with `npm run cli -- render <folder>`) |

## The notation in one minute

```
header  sidebar main V{1:3}  footer  H3
```

- Names are blocks. `V` puts the blocks before it **side by side** (a row); `H` **stacks** them (a column).
- The operator comes **after** its blocks (postfix), and a number says how many it takes: `H3` stacks three things.
- `{1:3}` gives the row's widths as shares: the main column is three times the sidebar.

So this page is a header, then a row with a narrow sidebar and a wide main area, then a footer. You rarely write it by hand: the editor and Kaity change it for you. The full grammar, including responsive rules, overlays, references and box types, is in [the notation spec](../../slicing-notation.md).

<!-- tykerf:footer -->
---

← [Exporting a page or a site](exporting.md) · [User guide index](README.md) · [TYKERF in Claude Desktop](claude-desktop.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
